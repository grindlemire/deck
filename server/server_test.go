package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testKey = "sekret"

// newTestServer publishes a one-talk site to a temp dir and serves it.
func newTestServer(t *testing.T) (*httptest.Server, *live) {
	t.Helper()
	files := map[string]string{"index.html": `<meta http-equiv="refresh" content="0; url=/talks">`}
	for name, body := range talkFiles() {
		files["talks/"+name] = body
	}
	return serveSite(t, files)
}

// talkFiles is a published talks directory: the list and two decks.
func talkFiles() map[string]string {
	deck := "<!doctype html><html><HEAD><title>Demo</title></head><body>" + strings.Repeat("<p>slide</p>", 200) + "</body></html>"
	return map[string]string{
		"index.html":       "<h1>Talks</h1>",
		"demo/index.html":  deck,
		"demo/notes.txt":   "notes",
		"demo/notes.json":  `["<p>hello</p>"]`,
		"other/index.html": "<html><head></head><body>other</body></html>",
	}
}

// serveSite writes files to a temp dir and serves them as a site.
func serveSite(t *testing.T, files map[string]string) (*httptest.Server, *live) {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	st, err := loadSite(dir)
	if err != nil {
		t.Fatal(err)
	}
	lv, err := newLive(st, options{key: testKey})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	lv.register(mux)
	mux.Handle("/", st)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, lv
}

var noRedirect = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func get(t *testing.T, url string, header ...string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	res, err := noRedirect.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return res, string(body)
}

func post(t *testing.T, url, key, body string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest("POST", url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

func TestSiteCleanURLs(t *testing.T) {
	srv, _ := newTestServer(t)
	for path, want := range map[string]string{
		"/":                      "200",
		"/talks":                 "200",
		"/talks/demo":            "200",
		"/talks/demo/notes.txt":  "200",
		"/nope":                  "404",
		"/index.html":            "308 /",
		"/talks/":                "308 /talks",
		"/talks/demo/":           "308 /talks/demo",
		"/talks/index.html":      "308 /talks",
		"/talks/demo/index.html": "308 /talks/demo",
		"/talks/demo.html":       "308 /talks/demo",
		"/talks/demo/?lead=x":    "308 /talks/demo?lead=x",
	} {
		res, _ := get(t, srv.URL+path)
		got := res.Status[:3]
		if loc := res.Header.Get("Location"); loc != "" {
			got += " " + loc
		}
		if got != want {
			t.Errorf("GET %s = %q; want %q", path, got, want)
		}
	}

	res, body := get(t, srv.URL+"/talks/demo")
	if !strings.Contains(body, "<p>slide</p>") || res.Header.Get("Content-Type") != "text/html; charset=utf-8" {
		t.Errorf("GET /talks/demo served %q (%s)", body[:40], res.Header.Get("Content-Type"))
	}
	if res.Header.Get("Cache-Control") != "public, max-age=0, must-revalidate" || res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("site headers missing: %v", res.Header)
	}

	// Go's client gunzips on its own unless the request names gzip itself.
	res, body = get(t, srv.URL+"/talks/demo", "Accept-Encoding", "gzip")
	if res.Header.Get("Content-Encoding") != "gzip" || strings.Contains(body, "<p>slide</p>") {
		t.Errorf("gzip not served: %v", res.Header)
	}
}

func TestFollowPage(t *testing.T) {
	srv, _ := newTestServer(t)
	_, body := get(t, srv.URL+"/talks/demo/live")
	want := `<HEAD>` + "\n" + `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` + "\n" + `<script>window.DECK_FOLLOW = "/talks/demo/events"; window.DECK_REACTIONS = [`
	if !strings.Contains(body, want) || !strings.Contains(body, "<p>slide</p>") {
		t.Errorf("follow page does not start its head with the settings:\n%.200s", body)
	}
	if res, _ := get(t, srv.URL+"/talks/nope/live"); res.StatusCode != 404 {
		t.Errorf("GET /talks/nope/live = %d; want 404", res.StatusCode)
	}
}

func TestLeadNeedsTheKey(t *testing.T) {
	srv, _ := newTestServer(t)
	url := srv.URL + "/talks/demo/state"
	for _, c := range []struct {
		key, body string
		want      int
	}{
		{"", `{"slide":0,"phase":1}`, 403},
		{"wrong", `{"slide":0,"phase":1}`, 403},
		{testKey, `{"slide":0}`, 400},
		{testKey, `{"slide":-1,"phase":1}`, 400},
		{testKey, `{"slide":0,"phase":1,"events":[{"t":"ink","x":2,"y":0}]}`, 400},
		{testKey, `{"slide":0,"phase":1,"events":[{"t":"laser","x":0.5,"y":0.5,"c":"red;"}]}`, 400},
		{testKey, `{"slide":0,"phase":1,"events":[{"t":"boom"}]}`, 400},
		{testKey, `{"slide":0,"phase":1,"events":[{"t":"laser","x":null,"y":null},{"t":"clear"}]}`, 200},
	} {
		res, body := post(t, url, c.key, c.body)
		if res.StatusCode != c.want {
			t.Errorf("POST key=%q %s = %d %q; want %d", c.key, c.body, res.StatusCode, body, c.want)
		}
		if res.Header.Get("Access-Control-Allow-Origin") != "*" {
			t.Errorf("POST %s: no CORS header, so a file:// deck could not read the answer", c.body)
		}
	}
	if res, _ := post(t, srv.URL+"/talks/nope/state", testKey, `{"slide":0,"phase":1}`); res.StatusCode != 404 {
		t.Errorf("POST to an unknown talk = %d; want 404", res.StatusCode)
	}
}

// stream reads server-sent events from an open /events request.
type stream struct {
	t      *testing.T
	events chan [2]string
}

func listen(t *testing.T, url string) *stream {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("GET %s: content type %q", url, ct)
	}
	s := &stream{t: t, events: make(chan [2]string, 16)}
	go func() {
		sc := bufio.NewScanner(res.Body)
		sc.Buffer(nil, 1<<20)
		var name, data string
		for sc.Scan() {
			line := sc.Text()
			switch {
			case line == "":
				if name != "" {
					s.events <- [2]string{name, data}
				}
				name, data = "", ""
			case strings.HasPrefix(line, "event: "):
				name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				data = strings.TrimPrefix(line, "data: ")
			}
		}
	}()
	return s
}

func (s *stream) next(wantEvent string, v any) {
	s.t.Helper()
	select {
	case e := <-s.events:
		if e[0] != wantEvent {
			s.t.Fatalf("got event %q (%s); want %q", e[0], e[1], wantEvent)
		}
		if err := json.Unmarshal([]byte(e[1]), v); err != nil {
			s.t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		s.t.Fatalf("no %q event", wantEvent)
	}
}

func (s *stream) quiet() {
	s.t.Helper()
	select {
	case e := <-s.events:
		s.t.Fatalf("unexpected event %q %s", e[0], e[1])
	case <-time.After(100 * time.Millisecond):
	}
}

func TestFollowersGetTheSlideLaserAndInk(t *testing.T) {
	srv, lv := newTestServer(t)
	events := srv.URL + "/talks/demo/events"
	state := srv.URL + "/talks/demo/state"

	early := listen(t, events)
	early.quiet() // nobody leads yet, so there is no slide to send
	lead := listen(t, events+"?lead")

	_, body := post(t, state, testKey, `{"slide":3,"phase":2,"events":[
		{"d":0,"t":"laser","x":0.1,"y":0.2,"c":"#ff2d2d"},
		{"d":5,"t":"ink","x":0.1,"y":0.2,"s":true,"c":"#ff2d2d"},
		{"d":9,"t":"ink","x":0.3,"y":0.4}]}`)
	if body != `{"followers":1}`+"\n" {
		t.Errorf("followers = %s; want 1 (the lead's own stream does not count)", body)
	}
	var s leadState
	var m fxMsg
	early.next("state", &s)
	early.next("fx", &m)
	if s != (leadState{Slide: 3, Phase: 2, Live: true}) || m.Slide != 3 || len(m.Events) != 3 || m.Events[1].D != 5 || !m.Events[1].S || m.Replay {
		t.Errorf("got %+v %+v", s, m)
	}
	lead.next("state", &s)
	lead.next("fx", &m)

	// A late joiner gets the slide and the ink on it, but not the laser.
	late := listen(t, events)
	late.next("state", &s)
	late.next("fx", &m)
	if s.Slide != 3 || !m.Replay || len(m.Events) != 2 || m.Events[0].T != "ink" {
		t.Errorf("late joiner got %+v %+v", s, m)
	}

	// A phase change keeps the ink; a new slide drops it.
	post(t, state, testKey, `{"slide":3,"phase":3}`)
	early.next("state", &s)
	late2 := listen(t, events)
	late2.next("state", &s)
	late2.next("fx", &m)
	post(t, state, testKey, `{"slide":4,"phase":1}`)
	early.next("state", &s)
	late3 := listen(t, events)
	late3.next("state", &s)
	late3.quiet()

	// Clear drops it too; posting the same state again sends nothing.
	post(t, state, testKey, `{"slide":4,"phase":1,"events":[{"t":"ink","x":0.5,"y":0.5,"s":true},{"t":"clear"}]}`)
	early.next("fx", &m)
	early.quiet()
	late4 := listen(t, events)
	late4.next("state", &s)
	late4.quiet()

	// A full-size clip, then stopping: followers hear both.
	post(t, state, testKey, `{"slide":4,"phase":1,"clip":true}`)
	early.next("state", &s)
	if !s.Clip || !s.Live {
		t.Errorf("clip state = %+v; want clip, live", s)
	}
	post(t, state, testKey, `{"slide":4,"phase":1,"live":false}`)
	s = leadState{}
	early.next("state", &s)
	if s.Live || s.Clip {
		t.Errorf("stopped state = %+v; want not live, no clip", s)
	}

	// A speaker who goes quiet without stopping: the talk ends on its own
	// once the silence is long enough, and not before.
	post(t, state, testKey, `{"slide":5,"phase":1}`)
	early.next("state", &s)
	rm := lv.rooms["demo"]
	rm.endIfSilent(time.Now().Add(leadSilence/2), leadSilence)
	early.quiet()
	rm.endIfSilent(time.Now().Add(leadSilence+time.Second), leadSilence)
	s = leadState{}
	early.next("state", &s)
	if s != (leadState{Slide: 5, Phase: 1}) {
		t.Errorf("after the silence: %+v; want slide 5, not live", s)
	}
}

func TestReactions(t *testing.T) {
	srv, lv := newTestServer(t)
	url := srv.URL + "/talks/demo/react"
	follower := listen(t, srv.URL+"/talks/demo/events")
	lead := listen(t, srv.URL+"/talks/demo/events?lead")

	for _, body := range []string{`{"e":"💩"}`, `{"e":"<script>"}`, `nope`} {
		if res, _ := post(t, url, "", body); res.StatusCode != 400 {
			t.Errorf("POST %s = %d; want 400", body, res.StatusCode)
		}
	}
	for range 2 {
		post(t, url, "", `{"e":"🔥"}`)
	}
	post(t, url, "", `{"e":"👏"}`)
	lv.rooms["demo"].flushReactions()
	var m struct{ Counts map[string]int }
	follower.next("react", &m)
	if m.Counts["🔥"] != 2 || m.Counts["👏"] != 1 {
		t.Errorf("counts = %v", m.Counts)
	}
	lead.next("react", &m)

	// One phone gets a burst, then is held to the rate.
	limited := 0
	for range reactBurst + 4 {
		if res, _ := post(t, url, "", `{"e":"😂","p":"phone-1"}`); res.StatusCode == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Error("no 429 after a burst from one phone")
	}
	lv.rooms["demo"].flushReactions()
	follower.next("react", &m)
	if n := m.Counts["😂"]; n > reactBurst {
		t.Errorf("%d reactions got through a burst of %d", n, reactBurst)
	}
	if res, _ := post(t, url, "", `{"e":"😂","p":"phone-2"}`); res.StatusCode != http.StatusNoContent {
		t.Errorf("another phone on the same wifi got %d", res.StatusCode)
	}

	// Phones made up by the dozen still share their address's allowance.
	limited = 0
	for i := range addrBurst + 10 {
		if res, _ := post(t, url, "", fmt.Sprintf(`{"e":"🔥","p":"fake-%d"}`, i)); res.StatusCode == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Error("no 429 for one address posing as many phones")
	}
}

func TestReactionsKeyOnTheRealAddress(t *testing.T) {
	r := httptest.NewRequest("POST", "/talks/demo/react", nil)
	r.RemoteAddr = "10.0.0.9:1234"
	r.Header.Set("X-Forwarded-For", "1.2.3.4") // a visitor can send this
	r.Header.Set("X-Real-IP", "203.0.113.7")   // and this, with no proxy in front
	if got := clientIP(r, ""); got != "10.0.0.9" {
		t.Errorf("clientIP with no -ip-header = %q; want the peer, not a header", got)
	}
	// Behind a proxy that sets the header (Railway's edge sets X-Real-IP).
	if got := clientIP(r, "X-Real-IP"); got != "203.0.113.7" {
		t.Errorf("clientIP with -ip-header X-Real-IP = %q; want the header", got)
	}
	r.Header.Set("X-Real-IP", "not an address")
	if got := clientIP(r, "X-Real-IP"); got != "10.0.0.9" {
		t.Errorf("clientIP with a junk header = %q; want the peer", got)
	}
}

func TestStreamsAreCapped(t *testing.T) {
	srv, lv := newTestServer(t)
	lv.streams.perAddr = 2
	events := srv.URL + "/talks/demo/events"
	listen(t, events)
	listen(t, events)
	res, err := http.Get(events)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("third stream from one address = %d; want 503", res.StatusCode)
	}
}

func TestNotesGoOnlyToTheKey(t *testing.T) {
	srv, _ := newTestServer(t)
	for _, c := range []struct {
		path, key string
		want      int
		body      string
	}{
		{"/talks/demo/notes.json", "", 404, ""},
		{"/talks/demo/notes.json", testKey, 404, ""},
		{"/talks/demo/notes", "", 403, ""},
		{"/talks/demo/notes", "wrong", 403, ""},
		{"/talks/demo/notes", testKey, 200, `["<p>hello</p>"]`},
		{"/talks/other/notes", testKey, 404, ""},
	} {
		req, _ := http.NewRequest("GET", srv.URL+c.path, nil)
		if c.key != "" {
			req.Header.Set("Authorization", "Bearer "+c.key)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != c.want || (c.body != "" && string(b) != c.body) {
			t.Errorf("GET %s key=%q = %d %q; want %d", c.path, c.key, res.StatusCode, b, c.want)
		}
	}
}

func TestRoomCapsReactionsPerFlush(t *testing.T) {
	_, lv := newTestServer(t)
	rm := lv.rooms["demo"]
	for range reactPerFlush * 3 {
		rm.react("🔥")
	}
	if rm.pendingN != reactPerFlush || rm.pending["🔥"] != reactPerFlush {
		t.Errorf("pending = %d; want the cap of %d", rm.pendingN, reactPerFlush)
	}
}

func TestPrefixFromTheSite(t *testing.T) {
	for _, tc := range []struct{ prefix, list string }{
		{"/decks", "/decks"},
		{"/a/b", "/a/b"},
		{"", "/"},
	} {
		t.Run(tc.list, func(t *testing.T) {
			files := map[string]string{"deck-site.json": fmt.Sprintf(`{"prefix": %q}`, tc.prefix)}
			for name, body := range talkFiles() {
				files[strings.TrimPrefix(tc.prefix+"/"+name, "/")] = body
			}
			srv, _ := serveSite(t, files)
			at := srv.URL + tc.prefix
			if res, body := get(t, srv.URL+tc.list); res.StatusCode != 200 || body != "<h1>Talks</h1>" {
				t.Errorf("GET %s = %d %q; want the talks list", tc.list, res.StatusCode, body)
			}
			if res, _ := get(t, at+"/demo"); res.StatusCode != 200 {
				t.Errorf("GET %s/demo = %d; want 200", tc.prefix, res.StatusCode)
			}
			_, body := get(t, at+"/demo/live")
			if want := fmt.Sprintf(`window.DECK_FOLLOW = "%s/demo/events"`, tc.prefix); !strings.Contains(body, want) {
				t.Errorf("follow page has no %s", want)
			}
			if res, _ := post(t, at+"/demo/state", testKey, `{"slide":0,"phase":1}`); res.StatusCode != 200 {
				t.Errorf("POST %s/demo/state = %d; want 200", tc.prefix, res.StatusCode)
			}
			if res, body := get(t, at+"/demo/notes", "Authorization", "Bearer "+testKey); res.StatusCode != 200 || body != `["<p>hello</p>"]` {
				t.Errorf("GET %s/demo/notes = %d %q; want the notes", tc.prefix, res.StatusCode, body)
			}
			if res, _ := get(t, srv.URL+"/deck-site.json"); res.StatusCode != 404 {
				t.Errorf("GET /deck-site.json = %d; want 404 (it is the server's, not a page)", res.StatusCode)
			}
			if tc.prefix != "" {
				if res, _ := get(t, srv.URL+"/talks/demo/live"); res.StatusCode != 404 {
					t.Errorf("GET /talks/demo/live = %d; want 404 under prefix %s", res.StatusCode, tc.prefix)
				}
			}
		})
	}
}

func TestBadPrefix(t *testing.T) {
	for _, p := range []string{"talks", "/talks/", "/a//b", "/../x"} {
		dir := t.TempDir()
		_ = os.WriteFile(filepath.Join(dir, "deck-site.json"), fmt.Appendf(nil, `{"prefix": %q}`, p), 0o644)
		if _, err := loadSite(dir); err == nil || !strings.Contains(err.Error(), "prefix") {
			t.Errorf("loadSite with prefix %q: err = %v; want one about the prefix", p, err)
		}
	}
}
