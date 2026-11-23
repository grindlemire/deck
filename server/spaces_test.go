package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	testSecret = "0123456789abcdef0123456789abcdef-test"
	owner      = "owner@example.com"
	visitor    = "visitor@example.com"
	gatePrefix = "/p/qmdjrq74"
)

// spaceSite is a space as publish would upload it: a report, a deck with
// its notes, and a 404 page.
func spaceSite(title string) map[string]string {
	deck := "<!doctype html><html><head><title>" + title + "</title></head><body>" + strings.Repeat("<p>slide</p>", 200) + "</body></html>"
	return map[string]string{
		"index.html":                    "<h1>" + title + " report</h1>",
		"404.html":                      "<h1>Not in " + title + "</h1>",
		"fonts/x.woff2":                 "font",
		"talks/mynqs-review/index.html": deck,
		"talks/mynqs-review/notes.json": `["<p>` + title + ` notes</p>"]`,
	}
}

// writeSpace writes files as space under dir, laid out like the bucket,
// with the manifest that publish writes last.
func writeSpace(t *testing.T, dir, space string, files map[string]string) {
	t.Helper()
	at := filepath.Join(dir, "spaces", space)
	if err := os.RemoveAll(at); err != nil {
		t.Fatal(err)
	}
	for name, body := range files {
		p := filepath.Join(at, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeManifest(at); err != nil {
		t.Fatal(err)
	}
}

// gated is a spaces server and the clock it checks signatures and
// manifests against.
type gated struct {
	t     *testing.T
	srv   *httptest.Server
	sp    *spaces
	clock atomic.Int64 // unix seconds
}

func newGated(t *testing.T, st store) *gated {
	t.Helper()
	g := &gated{t: t}
	g.clock.Store(time.Now().Unix())
	g.sp = newSpaces([]byte(testSecret), parseOwners(" Owner@Example.com , other@example.com"), st)
	g.sp.now = func() time.Time { return time.Unix(g.clock.Load(), 0) }
	g.srv = httptest.NewServer(g.sp)
	t.Cleanup(g.srv.Close)
	return g
}

func (g *gated) tick(d time.Duration) { g.clock.Add(int64(d / time.Second)) }

// req is a request as the gate sends it upstream for space and email,
// with the gate's prefix already taken off path.
func (g *gated) req(method, space, email, path, body string) *http.Request {
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	r, _ := http.NewRequest(method, g.srv.URL+path, rd)
	signGate(r, space, email, g.clock.Load())
	return r
}

func signGate(r *http.Request, space, email string, unix int64) {
	ts := strconv.FormatInt(unix, 10)
	r.Header.Set(hdrSpace, space)
	r.Header.Set(hdrPrefix, gatePrefix)
	r.Header.Set(hdrEmail, email)
	r.Header.Set(hdrTime, ts)
	r.Header.Set(hdrSignature, gateSignature([]byte(testSecret), space, gatePrefix, email, ts, r.Method, r.URL.Path))
}

func (g *gated) do(r *http.Request) (*http.Response, string) {
	g.t.Helper()
	res, err := noRedirect.Do(r)
	if err != nil {
		g.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

func (g *gated) get(space, email, path string) (*http.Response, string) {
	g.t.Helper()
	return g.do(g.req("GET", space, email, path, ""))
}

func dirGated(t *testing.T) (*gated, string) {
	t.Helper()
	dir := t.TempDir()
	writeSpace(t, dir, "nqs-review", spaceSite("NQS"))
	writeSpace(t, dir, "other", spaceSite("Other"))
	st, err := newDirStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	return newGated(t, st), dir
}

func TestGateHeadersAreRequired(t *testing.T) {
	g, _ := dirGated(t)
	now := g.clock.Load()
	cases := []struct {
		name string
		edit func(r *http.Request)
		want int
	}{
		{"signed", func(*http.Request) {}, 200},
		{"no headers", func(r *http.Request) {
			for _, k := range []string{hdrSpace, hdrPrefix, hdrEmail, hdrTime, hdrSignature} {
				r.Header.Del(k)
			}
		}, 403},
		{"no signature", func(r *http.Request) { r.Header.Del(hdrSignature) }, 403},
		{"garbage signature", func(r *http.Request) { r.Header.Set(hdrSignature, "not!base64") }, 403},
		{"another space", func(r *http.Request) { r.Header.Set(hdrSpace, "other") }, 403},
		{"another email", func(r *http.Request) { r.Header.Set(hdrEmail, owner) }, 403},
		{"another prefix", func(r *http.Request) { r.Header.Set(hdrPrefix, "/p/else") }, 403},
		{"another path", func(r *http.Request) { r.URL.Path = "/fonts/x.woff2" }, 403},
		{"another method", func(r *http.Request) { r.Method = "HEAD" }, 403},
		{"two spaces", func(r *http.Request) { r.Header.Add(hdrSpace, "other") }, 403},
		{"expired", func(r *http.Request) { signGate(r, "nqs-review", visitor, now-121) }, 403},
		{"from the future", func(r *http.Request) { signGate(r, "nqs-review", visitor, now+121) }, 403},
		{"a little old", func(r *http.Request) { signGate(r, "nqs-review", visitor, now-100) }, 200},
		{"wrong secret", func(r *http.Request) {
			ts := r.Header.Get(hdrTime)
			r.Header.Set(hdrSignature, gateSignature([]byte(strings.Repeat("x", 40)), "nqs-review", gatePrefix, visitor, ts, "GET", "/"))
		}, 403},
	}
	for _, c := range cases {
		r := g.req("GET", "nqs-review", visitor, "/", "")
		c.edit(r)
		res, body := g.do(r)
		if res.StatusCode != c.want {
			t.Errorf("%s: %d %q; want %d", c.name, res.StatusCode, body, c.want)
		}
		if c.want == 403 && strings.Contains(body, "report") {
			t.Errorf("%s: refused, but served the page", c.name)
		}
	}
}

func TestSpaceComesFromTheHeader(t *testing.T) {
	g, _ := dirGated(t)
	if _, body := g.get("nqs-review", visitor, "/"); body != "<h1>NQS report</h1>" {
		t.Errorf("nqs-review / = %q", body)
	}
	if _, body := g.get("other", visitor, "/"); body != "<h1>Other report</h1>" {
		t.Errorf("other / = %q", body)
	}
	// Paths that name the other space reach nothing of it.
	for _, p := range []string{"/other", "/spaces/other", "/spaces/other/index.html", "/../other/index.html", "/other/index.html"} {
		res, body := g.get("nqs-review", visitor, p)
		if strings.Contains(body, "Other report") || (res.StatusCode != 404 && res.StatusCode != 308) {
			t.Errorf("nqs-review %s = %d %q", p, res.StatusCode, body)
		}
	}
	if res, _ := g.get("nobody", visitor, "/"); res.StatusCode != 404 {
		t.Errorf("a space with no manifest = %d; want 404", res.StatusCode)
	}
}

func TestSpaceServesItsSite(t *testing.T) {
	g, _ := dirGated(t)
	for p, want := range map[string]string{
		"/":                              "200",
		"/talks/mynqs-review":            "200",
		"/fonts/x.woff2":                 "200",
		"/nope":                          "404",
		"/talks/mynqs-review/notes.json": "404",
		"/_manifest.json":                "404",
		"/talks/mynqs-review/":           "308 " + gatePrefix + "/talks/mynqs-review",
		"/index.html":                    "308 " + gatePrefix + "/",
		"/talks/mynqs-review.html":       "308 " + gatePrefix + "/talks/mynqs-review",
	} {
		res, body := g.get("nqs-review", visitor, p)
		got := res.Status[:3]
		if loc := res.Header.Get("Location"); loc != "" {
			got += " " + loc
		}
		if got != want {
			t.Errorf("GET %s = %q; want %q", p, got, want)
		}
		if strings.Contains(body, "NQS notes") {
			t.Errorf("GET %s served the notes", p)
		}
	}
	if _, body := g.get("nqs-review", visitor, "/nope"); body != "<h1>Not in NQS</h1>" {
		t.Errorf("404 page = %q", body)
	}
	r := g.req("GET", "nqs-review", visitor, "/talks/mynqs-review", "")
	r.Header.Set("Accept-Encoding", "gzip")
	res, _ := g.do(r)
	if res.Header.Get("Content-Encoding") != "gzip" || res.Header.Get("ETag") == "" {
		t.Errorf("deck not gzipped with an ETag: %v", res.Header)
	}
	if res, _ := g.do(g.req("POST", "nqs-review", visitor, "/", "x")); res.StatusCode != 405 {
		t.Errorf("POST / = %d; want 405", res.StatusCode)
	}
}

func TestSpaceLiveIsLedByTheOwners(t *testing.T) {
	g, _ := dirGated(t)
	const talk = "/talks/mynqs-review"

	_, page := g.get("nqs-review", visitor, talk+"/live")
	if want := `window.DECK_FOLLOW = "` + gatePrefix + `/talks/mynqs-review/events"`; !strings.Contains(page, want) {
		t.Errorf("follow page has no %s:\n%.300s", want, page)
	}
	if res, _ := g.get("nqs-review", visitor, "/talks/nope/live"); res.StatusCode != 404 {
		t.Errorf("unknown talk's live page = %d", res.StatusCode)
	}

	follower := listenTo(t, g.req("GET", "nqs-review", visitor, talk+"/events", ""))
	elsewhere := listenTo(t, g.req("GET", "other", visitor, talk+"/events", ""))

	state := `{"slide":2,"phase":1}`
	if res, _ := g.do(g.req("POST", "nqs-review", visitor, talk+"/state", state)); res.StatusCode != 403 {
		t.Errorf("visitor POST state = %d; want 403", res.StatusCode)
	}
	// The gate strips Authorization, but a key would not help anyway.
	r := g.req("POST", "nqs-review", visitor, talk+"/state", state)
	r.Header.Set("Authorization", "Bearer anything")
	if res, _ := g.do(r); res.StatusCode != 403 {
		t.Errorf("visitor with a key POST state = %d; want 403", res.StatusCode)
	}
	res, body := g.do(g.req("POST", "nqs-review", owner, talk+"/state", state))
	if res.StatusCode != 200 || body != `{"followers":1}`+"\n" {
		t.Errorf("owner POST state = %d %q; want 200 and 1 follower", res.StatusCode, body)
	}
	if res.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("spaces mode answers cross-origin: %v", res.Header)
	}
	var s leadState
	follower.next("state", &s)
	if s.Slide != 2 || !s.Live {
		t.Errorf("follower got %+v", s)
	}
	elsewhere.quiet() // the same talk name in another space is another room

	if res, _ := g.get("nqs-review", visitor, talk+"/notes"); res.StatusCode != 403 {
		t.Errorf("visitor GET notes = %d; want 403", res.StatusCode)
	}
	if res, body := g.get("nqs-review", owner, talk+"/notes"); res.StatusCode != 200 || body != `["<p>NQS notes</p>"]` {
		t.Errorf("owner GET notes = %d %q", res.StatusCode, body)
	}
	if _, body := g.get("other", "other@example.com", talk+"/notes"); body != `["<p>Other notes</p>"]` {
		t.Errorf("other space's notes = %q", body)
	}
}

func TestSpaceReactionsAreLimitedByEmail(t *testing.T) {
	g, _ := dirGated(t)
	react := func(email string, i int) int {
		res, _ := g.do(g.req("POST", "nqs-review", email, "/talks/mynqs-review/react", fmt.Sprintf(`{"e":"🔥","p":"phone-%d"}`, i)))
		return res.StatusCode
	}
	limited := 0
	for i := range addrBurst + 10 {
		if react(visitor, i) == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Error("no 429 for one email posing as many phones")
	}
	if code := react("someone@example.com", 0); code != http.StatusNoContent {
		t.Errorf("another email = %d; want 204", code)
	}
}

func TestSpaceRepublishIsPickedUp(t *testing.T) {
	g, dir := dirGated(t)
	const talk = "/talks/mynqs-review"
	if _, body := g.get("nqs-review", visitor, "/"); body != "<h1>NQS report</h1>" {
		t.Fatalf("/ = %q", body)
	}
	follower := listenTo(t, g.req("GET", "nqs-review", visitor, talk+"/events", ""))

	files := spaceSite("NQS")
	files["index.html"] = "<h1>NQS report, v2</h1>"
	delete(files, "talks/mynqs-review/index.html")
	delete(files, "talks/mynqs-review/notes.json")
	files["talks/next/index.html"] = "<html><head></head><body>next</body></html>"
	writeSpace(t, dir, "nqs-review", files)

	// Within the recheck, the last look stands.
	g.tick(recheck / 2)
	if _, body := g.get("nqs-review", visitor, "/"); body != "<h1>NQS report</h1>" {
		t.Errorf("before the recheck / = %q", body)
	}
	g.tick(recheck)
	if _, body := g.get("nqs-review", visitor, "/"); body != "<h1>NQS report, v2</h1>" {
		t.Errorf("after the recheck / = %q; want v2", body)
	}
	if res, _ := g.get("nqs-review", visitor, talk+"/live"); res.StatusCode != 404 {
		t.Errorf("unpublished talk's live page = %d; want 404", res.StatusCode)
	}
	if res, _ := g.get("nqs-review", visitor, "/talks/next/live"); res.StatusCode != 200 {
		t.Errorf("new talk's live page = %d; want 200", res.StatusCode)
	}
	// The unpublished talk's room let its listeners go.
	select {
	case e, ok := <-follower.events:
		if ok {
			t.Errorf("unexpected event %v", e)
		}
	case <-time.After(2 * time.Second):
		t.Error("the unpublished talk's stream stayed open")
	}

	// A space whose manifest goes away is gone.
	os.Remove(filepath.Join(dir, "spaces", "nqs-review", manifestFile))
	g.tick(recheck)
	if res, _ := g.get("nqs-review", visitor, "/"); res.StatusCode != 404 {
		t.Errorf("space with its manifest removed = %d; want 404", res.StatusCode)
	}
}

// fakeS3 is a path-style bucket that checks each request's signature.
type fakeS3 struct {
	t       *testing.T
	mu      sync.Mutex
	objects map[string]string // by key
	gets    map[string]int
	notMod  int
}

func (f *fakeS3) put(prefix string, files map[string]string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	dir := f.t.TempDir()
	writeSpace(f.t, dir, "s", files)
	_ = filepath.Walk(filepath.Join(dir, "spaces", "s"), func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			rel, _ := filepath.Rel(filepath.Join(dir, "spaces", "s"), p)
			b, _ := os.ReadFile(p)
			f.objects[prefix+filepath.ToSlash(rel)] = string(b)
		}
		return nil
	})
}

func (f *fakeS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Sign what arrived again, the way the client should have.
	at, err := time.Parse("20060102T150405Z", r.Header.Get("X-Amz-Date"))
	check, _ := http.NewRequest(r.Method, "http://"+r.Host+r.URL.EscapedPath(), nil)
	signV4(check, "AK", "SK", "auto", "s3", r.Header.Get("X-Amz-Content-Sha256"), at)
	if err != nil || r.Header.Get("Authorization") != check.Header.Get("Authorization") {
		http.Error(w, "<Error><Code>SignatureDoesNotMatch</Code></Error>", http.StatusForbidden)
		return
	}
	key, ok := strings.CutPrefix(r.URL.Path, "/bk/")
	f.mu.Lock()
	body, found := f.objects[key]
	f.gets[key]++
	f.mu.Unlock()
	if !ok || !found {
		http.Error(w, "<Error><Code>NoSuchKey</Code></Error>", http.StatusNotFound)
		return
	}
	etag := `"` + hexSHA256([]byte(body))[:16] + `"`
	if r.Header.Get("If-None-Match") == etag {
		f.mu.Lock()
		f.notMod++
		f.mu.Unlock()
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("ETag", etag)
	_, _ = io.WriteString(w, body)
}

func TestSpacesFromTheBucket(t *testing.T) {
	bucket := &fakeS3{t: t, objects: map[string]string{}, gets: map[string]int{}}
	bucket.put("spaces/nqs-review/", spaceSite("NQS"))
	s3srv := httptest.NewServer(bucket)
	defer s3srv.Close()
	c, err := newS3Client(s3srv.URL, "bk", "auto", "AK", "SK", false)
	if err != nil {
		t.Fatal(err)
	}
	g := newGated(t, c)

	for range 3 {
		if res, body := g.get("nqs-review", visitor, "/"); res.StatusCode != 200 || body != "<h1>NQS report</h1>" {
			t.Fatalf("/ = %d %q", res.StatusCode, body)
		}
	}
	if res, body := g.get("nqs-review", owner, "/talks/mynqs-review/notes"); res.StatusCode != 200 || body != `["<p>NQS notes</p>"]` {
		t.Errorf("owner notes = %d %q", res.StatusCode, body)
	}
	if res, _ := g.get("nqs-review", visitor, "/talks/mynqs-review/notes.json"); res.StatusCode != 404 {
		t.Errorf("notes.json = %d; want 404", res.StatusCode)
	}
	if n := bucket.gets["spaces/nqs-review/index.html"]; n != 1 {
		t.Errorf("index.html fetched %d times; want once, then cached", n)
	}
	if n := bucket.gets["spaces/nqs-review/"+manifestFile]; n != 1 {
		t.Errorf("manifest fetched %d times within the recheck; want 1", n)
	}

	// A recheck with nothing new is a 304; a publish shows up on the next.
	g.tick(recheck)
	g.get("nqs-review", visitor, "/")
	if bucket.notMod != 1 {
		t.Errorf("recheck of an unchanged manifest: %d 304s; want 1", bucket.notMod)
	}
	files := spaceSite("NQS")
	files["index.html"] = "<h1>NQS report, v2</h1>"
	bucket.put("spaces/nqs-review/", files)
	g.tick(recheck)
	if _, body := g.get("nqs-review", visitor, "/"); body != "<h1>NQS report, v2</h1>" {
		t.Errorf("after a publish / = %q; want v2", body)
	}

	// A file the manifest names that the bucket has with other bytes (a
	// publish under way) is not served or cached.
	bucket.mu.Lock()
	bucket.objects["spaces/nqs-review/fonts/x.woff2"] = "half-uploaded"
	bucket.mu.Unlock()
	if res, _ := g.get("nqs-review", visitor, "/fonts/x.woff2"); res.StatusCode != 502 {
		t.Errorf("mismatched file = %d; want 502", res.StatusCode)
	}
	if res, _ := g.get("missing", visitor, "/"); res.StatusCode != 404 {
		t.Errorf("space not in the bucket = %d; want 404", res.StatusCode)
	}
}

func TestSpacesNeedALongSecret(t *testing.T) {
	if _, err := spacesFromEnv("short", t.TempDir()); err == nil || !strings.Contains(err.Error(), "DECK_GATE_SECRET") {
		t.Errorf("short secret: err = %v", err)
	}
	for _, k := range []string{envEndpoint, envBucket, envAccessKey, envSecretKey} {
		t.Setenv(k, "")
	}
	if _, err := spacesFromEnv(testSecret, ""); err == nil || !strings.Contains(err.Error(), envBucket) {
		t.Errorf("no bucket and no dir: err = %v", err)
	}
}
