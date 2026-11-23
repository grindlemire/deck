package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// anonGated serves a space with richDeck as talks/t1, and its notes.
func anonGated(t *testing.T) *gated {
	t.Helper()
	dir := t.TempDir()
	writeSpace(t, dir, "s", map[string]string{
		"index.html":          "<h1>report SECRET-REPORT</h1>",
		"talks/t1/index.html": richDeck(),
		"talks/t1/notes.json": `["notes-SECRET"]`,
	})
	st, err := newDirStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	g := newGated(t, st)
	g.sp.ipHeader = "X-Real-IP"
	return g
}

const anon = "" // the gate's email for a signed-out follower

func (g *gated) lead(slide int, live bool) {
	g.t.Helper()
	res, body := g.do(g.req("POST", "s", owner, "/talks/t1/state", fmt.Sprintf(`{"slide":%d,"phase":1,"live":%t}`, slide, live)))
	if res.StatusCode != 200 {
		g.t.Fatalf("owner POST state = %d %s", res.StatusCode, body)
	}
}

// slides is /slides for a signed-out follower: the slides, or the status.
func (g *gated) slides(query string) ([]string, int, string) {
	g.t.Helper()
	res, body := g.get("s", anon, "/talks/t1/slides"+query)
	if res.StatusCode != 200 {
		return nil, res.StatusCode, body
	}
	var r slidesReply
	if err := json.Unmarshal([]byte(body), &r); err != nil {
		g.t.Fatal(err)
	}
	return r.Slides, 200, body
}

func TestAnonOnlyFollows(t *testing.T) {
	g := anonGated(t)
	for _, c := range []struct{ method, path string }{
		{"GET", "/"},
		{"GET", "/index.html"},
		{"GET", "/talks/t1"},
		{"GET", "/talks/t1/notes"},
		{"GET", "/talks/t1/notes.json"},
		{"GET", "/talks/t1/index.html"},
		{"POST", "/talks/t1/state"},
		{"POST", "/talks/t1/live"},
		{"POST", "/talks/t1/slides"},
		{"GET", "/talks/t1/react"},
		{"GET", "/talks/t1/live/more"},
		{"GET", "/talks//live"},
		{"GET", "/x/talks/t1/live"},
	} {
		res, body := g.do(g.req(c.method, "s", anon, c.path, "{}"))
		if res.StatusCode != 403 || len(leaks(body)) > 0 || strings.Contains(body, "REPORT") {
			t.Errorf("anon %s %s = %d %q; want 403", c.method, c.path, res.StatusCode, body)
		}
	}
	// A signed-out request is still signed: a forged email is refused.
	r := g.req("GET", "s", anon, "/talks/t1/notes", "")
	r.Header.Set(hdrEmail, owner)
	if res, _ := g.do(r); res.StatusCode != 403 {
		t.Errorf("anon signature with an owner's email = %d; want 403", res.StatusCode)
	}
}

func TestAnonGetsNothingWhileNotLive(t *testing.T) {
	g := anonGated(t)
	check := func(when string) {
		t.Helper()
		res, body := g.get("s", anon, "/talks/t1/live")
		if res.StatusCode != 200 || !strings.Contains(body, "isn't live right now") {
			t.Errorf("%s: anon /live = %d %.80q; want the not-live page", when, res.StatusCode, body)
		}
		if l := leaks(body); len(l) > 0 || strings.Contains(body, "Rich") || strings.Contains(body, "slide") {
			t.Errorf("%s: the not-live page has deck content %v:\n%s", when, l, body)
		}
		if _, code, _ := g.slides("?upto=99"); code != 403 {
			t.Errorf("%s: anon /slides = %d; want 403", when, code)
		}
		if res, _ := g.get("s", anon, "/talks/t1/events"); res.StatusCode != 403 {
			t.Errorf("%s: anon /events = %d; want 403", when, res.StatusCode)
		}
		if res, _ := g.do(g.req("POST", "s", anon, "/talks/t1/react", `{"e":"🔥"}`)); res.StatusCode != 403 {
			t.Errorf("%s: anon /react = %d; want 403", when, res.StatusCode)
		}
	}
	check("before the talk")
	g.lead(2, true)
	g.lead(2, false)
	check("after the talk")
}

func TestAnonGetsOnlyTheSlidesShown(t *testing.T) {
	g := anonGated(t)
	g.lead(1, true)

	res, shell := g.get("s", anon, "/talks/t1/live")
	if res.StatusCode != 200 || !strings.Contains(shell, "window.DECK_ANON") {
		t.Fatalf("anon /live while live = %d; want the shell", res.StatusCode)
	}
	if l := leaks(shell); len(l) > 0 {
		t.Errorf("the shell has %v", l)
	}
	if res.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("shell Cache-Control = %q", res.Header.Get("Cache-Control"))
	}

	got, _, body := g.slides("?upto=99")
	if len(got) != 2 || got[0] != richSlides[0] || got[1] != richSlides[1] {
		t.Errorf("slides upto 99 with slide 1 shown = %v", got)
	}
	if l := leaks(body, "SECRET-0", "SECRET-1", "SOURCE-2"); len(l) > 0 {
		t.Errorf("/slides has %v", l)
	}
	if got, _, _ := g.slides("?upto=0"); len(got) != 1 {
		t.Errorf("slides upto 0 = %d; want 1", len(got))
	}
	if got, _, _ := g.slides(""); len(got) != 2 {
		t.Errorf("slides with no upto = %d; want as far as shown, 2", len(got))
	}
	if _, code, _ := g.slides("?upto=-1"); code != 400 {
		t.Errorf("slides upto -1 = %d; want 400", code)
	}

	// Going ahead and back: the furthest slide shown counts.
	follower := listenTo(t, g.req("GET", "s", anon, "/talks/t1/events", ""))
	var s leadState
	follower.next("state", &s)
	g.lead(3, true)
	g.lead(1, true)
	follower.next("state", &s)
	follower.next("state", &s)
	if got, _, _ := g.slides("?upto=99"); len(got) != 4 {
		t.Errorf("after showing slide 3 then 1: %d slides; want 4", len(got))
	}

	// Stopping ends the follower's stream with "ended", and forgets.
	signedIn := listenTo(t, g.req("GET", "s", visitor, "/talks/t1/events", ""))
	signedIn.next("state", &s)
	g.lead(1, false)
	follower.next("state", &s)
	var ended struct{}
	follower.next("ended", &ended)
	if _, open := <-follower.events; open {
		t.Error("the anon stream stayed open after the talk ended")
	}
	signedIn.next("state", &s)
	if s.Live {
		t.Errorf("signed-in follower got %+v; want not live", s)
	}
	signedIn.quiet() // and stays connected

	g.lead(0, true)
	if got, _, body := g.slides("?upto=99"); len(got) != 1 || len(leaks(body, "SECRET-0")) > 0 {
		t.Errorf("a new live session from slide 0: %d slides %v; want only slide 0", len(got), leaks(body, "SECRET-0"))
	}

	// A speaker who goes silent ends the session too.
	rm := g.sp.live.lookup(roomID("s", "t1"))
	rm.endIfSilent(time.Now().Add(leadSilence+time.Second), leadSilence)
	if _, code, _ := g.slides("?upto=99"); code != 403 {
		t.Errorf("after the silence /slides = %d; want 403", code)
	}
	if max, _ := rm.shown(); max != -1 {
		t.Errorf("maxShown after the silence = %d; want -1", max)
	}
}

func TestAnonReactionsAreLimitedByAddress(t *testing.T) {
	g := anonGated(t)
	g.lead(0, true)
	react := func(ip string, i int) int {
		r := g.req("POST", "s", anon, "/talks/t1/react", fmt.Sprintf(`{"e":"🔥","p":"phone-%d"}`, i))
		r.Header.Set("X-Real-IP", ip)
		res, _ := g.do(r)
		return res.StatusCode
	}
	limited := 0
	for i := range addrBurst + 10 {
		if react("203.0.113.7", i) == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Error("no 429 for one address posing as many phones")
	}
	if code := react("203.0.113.8", 0); code != http.StatusNoContent {
		t.Errorf("another address = %d; want 204", code)
	}
	// One phone is held to its own rate as well.
	limited = 0
	for range reactBurst + 4 {
		if react("198.51.100.1", 999) == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Error("no 429 for one phone")
	}
}

func TestSignedInFollowersAreUnchanged(t *testing.T) {
	g := anonGated(t)
	// Not live: the whole deck, the follow page, the report.
	if _, body := g.get("s", visitor, "/talks/t1/live"); !strings.Contains(body, "SECRET-3") || !strings.Contains(body, "window.DECK_FOLLOW") || strings.Contains(body, "DECK_ANON") {
		t.Errorf("signed-in /live is not the whole deck in follow mode")
	}
	if _, body := g.get("s", visitor, "/"); !strings.Contains(body, "SECRET-REPORT") {
		t.Errorf("signed-in / = %q", body)
	}
	listenTo(t, g.req("GET", "s", visitor, "/talks/t1/events", "")).quiet()
	if res, _ := g.get("s", visitor, "/talks/t1/notes"); res.StatusCode != 403 {
		t.Errorf("visitor notes = %d; want 403", res.StatusCode)
	}
	if res, body := g.get("s", owner, "/talks/t1/notes"); res.StatusCode != 200 || body != `["notes-SECRET"]` {
		t.Errorf("owner notes = %d %q", res.StatusCode, body)
	}
}
