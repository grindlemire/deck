package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// The slides of richDeck, each with a marker that must never reach a
// signed-out follower before the speaker shows that slide.
var richSlides = []string{
	`<section class="slide title-slide" data-beat="0.1"><h1 class="headline">SECRET-0 title</h1></section>`,
	`<section class="slide" data-src="S2.1"><h2>SECRET-1</h2><section class="inner"><p>nested SECRET-1b</p></section>` +
		`<script>const s = "</section> SECRET-1c";</script><p title="a > b">SECRET-1d</p></section>`,
	`<SECTION class="slide divider" data-phases="2"><!-- </section> --><p>SECRET-2</p><img src="data:image/png;base64,SECRET2IMG"></SECTION>`,
	`<section class='slide credits-slide' data-src="S3"><p data-build>SECRET-3 last</p></section>`,
}

// richDeck is a published deck with content in every place the shell
// must leave out: the slides, a comment, text outside the slides, the
// description and link preview, the sources and the rehearsals.
func richDeck() string {
	return `<!doctype html>
<html lang="en">
<head>
<script type="application/json" id="dk-config">{"site":"","prefix":"/p/qmdjrq74/talks","auth":"gate","talk":"t1"}</script>
<script type="application/json" id="dk-sources">{"S1":{"kind":"other","title":"SOURCE-1-UNCITED"},"S2":{"kind":"other","title":"SOURCE-2"},"S3":{"kind":"other","title":"SOURCE-3"}}</script>
<meta charset="utf-8">
<title>Rich</title>
<meta name="description" content="DESCRIPTION-SECRET">
<meta property="og:description" content="OG-SECRET">
<style>.slide{color:red}</style>
</head>
<body>
<!-- a comment with <section class="slide">COMMENT-SECRET</section> -->
<main class="deck" data-duration="30:00">
<p>MAIN-TEXT-SECRET</p>
` + strings.Join(richSlides, "\n") + `
</main>
<script>/* the engine */ window.ENGINE = "<section class=\"slide\">kept, it is code</section>";</script>
<script type="application/json" id="dk-rehearsals">{"REHEARSAL-SECRET":1}</script>
</body>
</html>
`
}

// leaks names every secret marker in body that is not allowed.
func leaks(body string, allowed ...string) []string {
	var out []string
	for _, s := range []string{"SECRET-0", "SECRET-1", "SECRET-2", "SECRET2IMG", "SECRET-3", "COMMENT-SECRET", "MAIN-TEXT-SECRET", "DESCRIPTION-SECRET", "OG-SECRET", "SOURCE-1", "SOURCE-2", "SOURCE-3", "REHEARSAL-SECRET", "notes-SECRET"} {
		ok := false
		for _, a := range allowed {
			if strings.HasPrefix(s, a) {
				ok = true
			}
		}
		if !ok && strings.Contains(body, s) {
			out = append(out, s)
		}
	}
	return out
}

func TestSplitDeck(t *testing.T) {
	d, err := splitDeck([]byte(richDeck()))
	if err != nil {
		t.Fatal(err)
	}
	if len(d.slides) != len(richSlides) {
		t.Fatalf("%d slides; want %d", len(d.slides), len(richSlides))
	}
	for i, s := range d.slides {
		if string(s) != richSlides[i] {
			t.Errorf("slide %d =\n  %s\nwant\n  %s", i, s, richSlides[i])
		}
	}
	shell, err := anonShell(d, "/p/qmdjrq74/talks", "t1")
	if err != nil {
		t.Fatal(err)
	}
	page := string(shell.body)
	if l := leaks(page); len(l) > 0 {
		t.Errorf("the shell has %v:\n%s", l, page)
	}
	for _, want := range []string{
		`id="dk-config"`, `<title>Rich</title>`, `.slide{color:red}`, `window.ENGINE`,
		`window.DECK_ANON = "/p/qmdjrq74/talks/t1/slides"`, `window.DECK_FOLLOW = "/p/qmdjrq74/talks/t1/events"`,
		`<main class="deck" data-duration="30:00">`,
	} {
		if !strings.Contains(page, want) {
			t.Errorf("the shell has no %s", want)
		}
	}
	if n := strings.Count(page, `<section class="slide"></section>`); n != len(richSlides) {
		t.Errorf("%d placeholders; want %d", n, len(richSlides))
	}

	r := d.reply(1)
	if len(r.Slides) != 2 || r.Slides[1] != richSlides[1] {
		t.Errorf("reply(1) = %v", r.Slides)
	}
	b, _ := json.Marshal(r)
	if l := leaks(string(b), "SECRET-0", "SECRET-1", "SOURCE-2"); len(l) > 0 {
		t.Errorf("reply(1) has %v", l)
	}
	if len(d.reply(-1).Slides) != 0 || len(d.reply(99).Slides) != len(richSlides) {
		t.Errorf("reply out of range: %d, %d", len(d.reply(-1).Slides), len(d.reply(99).Slides))
	}

	for _, bad := range []string{"<html><body><p>no deck</p></body></html>", "<html><head></head><body><main class=\"deck\"><section class=\"slide\">open"} {
		if _, err := splitDeck([]byte(bad)); err == nil {
			t.Errorf("splitDeck(%q) took it", bad)
		}
	}
}

func TestAnonShellFromAPublishedDeck(t *testing.T) {
	// DECK_TEST_DECK names a deck publish wrote, to check the shell
	// against a real one: every slide gone, the engine kept.
	p := os.Getenv("DECK_TEST_DECK")
	if p == "" {
		t.Skip("set DECK_TEST_DECK to a published deck's index.html")
	}
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	d, err := splitDeck(b)
	if err != nil {
		t.Fatal(err)
	}
	shell, _ := anonShell(d, "/p/x/talks", "t")
	page := string(shell.body)
	for i, s := range d.slides {
		// Each slide's own text is gone from the shell.
		inner := s[strings.IndexByte(string(s), '>')+1:]
		if len(inner) > 40 && strings.Contains(page, string(inner[:40])) {
			t.Errorf("slide %d is in the shell", i)
		}
	}
	if strings.Count(page, `<section class="slide"></section>`) != len(d.slides) {
		t.Errorf("placeholders != %d slides", len(d.slides))
	}
	t.Logf("%d slides, deck %d bytes, shell %d bytes", len(d.slides), len(b), len(page))
}
