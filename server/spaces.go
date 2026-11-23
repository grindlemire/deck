package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Spaces mode: private sites behind alethi.dev's gate, one per space,
// read from a bucket that alethi publish fills:
//
//	spaces/<space>/_manifest.json   written last by publish
//	spaces/<space>/<path>           every file of the space's site
//
// A space is served like a published site (clean URLs, gzip, ETags, its
// 404.html), with its decks at talks/<talk>/index.html and their notes in
// talks/<talk>/notes.json, never served as a file. Each deck has a live
// room. The owners (DECK_OWNERS) lead and read the notes; nobody needs a
// key, and everyone else gets 403 on those.

// store is where the spaces are: a bucket, or a directory laid out like
// one (-spaces-dir). get is a GET, conditional when etag is set.
type store interface {
	get(ctx context.Context, key, etag string) (body []byte, newEtag string, err error)
	String() string
}

// dirStore is a directory laid out like the bucket, for local runs and
// tests: <dir>/spaces/<space>/_manifest.json and so on.
type dirStore struct{ root *os.Root }

func newDirStore(dir string) (*dirStore, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	return &dirStore{root: root}, nil
}

func (d *dirStore) String() string { return "directory " + d.root.Name() }

func (d *dirStore) get(_ context.Context, key, etag string) ([]byte, string, error) {
	body, err := d.root.ReadFile(filepath.FromSlash(key))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, "", errNotFound
	}
	if err != nil {
		return nil, "", err
	}
	tag := `"` + hexSHA256(body) + `"`
	if etag == tag {
		return nil, etag, errNotModified
	}
	return body, tag, nil
}

const (
	manifestFile = "_manifest.json"
	// recheck is how often a space's manifest is looked at again, so a
	// publish shows up within seconds.
	recheck = 10 * time.Second
)

// manifest is a space's _manifest.json.
type manifest struct {
	Version string                   `json:"version"` // RFC 3339, when it was published
	Files   map[string]manifestEntry `json:"files"`   // by slash path, no leading slash
}

type manifestEntry struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

var sha256RE = regexp.MustCompile(`^[0-9a-f]{64}$`)

func parseManifest(space string, b []byte) (*manifest, error) {
	var m manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("%s/%s: %w", space, manifestFile, err)
	}
	for p, e := range m.Files {
		e.SHA256 = strings.ToLower(e.SHA256)
		m.Files[p] = e
		if !fs.ValidPath(p) || p == "." || strings.Contains(p, `\`) || !sha256RE.MatchString(e.SHA256) || e.Size < 0 || e.Size > maxObject {
			slog.Warn("manifest: skipping a bad entry", "space", space, "path", p)
			delete(m.Files, p)
		}
	}
	return &m, nil
}

// spaces serves every space behind the gate.
type spaces struct {
	secret []byte
	owners map[string]bool
	store  store
	live   *live
	mux    *http.ServeMux // a space's routes, after the gate check
	now    func() time.Time

	mu     sync.Mutex
	byName map[string]*space
	blobs  map[string]*file // by sha256 and extension, across every space
}

// space is one space's current publish, re-read from the store at most
// every recheck.
type space struct {
	name string

	mu      sync.Mutex // held while checking the manifest
	checked time.Time
	etag    string // the manifest's, for the conditional GET
	err     error  // the last check's, while there is nothing to serve

	cur atomic.Pointer[version] // nil: no such space (or not read yet)
}

// version is one publish of a space.
type version struct {
	site  *site
	files *spaceFiles
	talks map[string]bool
}

// spaceFiles is a space's files as its manifest lists them, read from the
// store the first time each is asked for.
type spaceFiles struct {
	sp      *spaces
	space   string
	m       map[string]manifestEntry
	modTime time.Time
}

func (f *spaceFiles) paths() []string { return slices.Collect(maps.Keys(f.m)) }

func (f *spaceFiles) open(ctx context.Context, p string) (*file, error) {
	e, ok := f.m[p]
	if !ok {
		return nil, nil
	}
	return f.sp.blob(ctx, f.space, p, e, f.modTime)
}

func newSpaces(secret []byte, owners map[string]bool, st store) *spaces {
	sp := &spaces{
		secret: secret,
		owners: owners,
		store:  st,
		now:    time.Now,
		byName: map[string]*space{},
		blobs:  map[string]*file{},
	}
	sp.live = newLive(sp.find, false)
	sp.mux = http.NewServeMux()
	sp.live.register(sp.mux, "/talks")
	sp.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		requestOf(r).v.site.ServeHTTP(w, r)
	})
	return sp
}

// request is what the gate check found, for the routes after it.
type request struct {
	id identity
	v  *version
}

type requestKey struct{}

func requestOf(r *http.Request) *request { return r.Context().Value(requestKey{}).(*request) }

func (sp *spaces) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id, err := verifyGate(sp.secret, r, sp.now())
	if err != nil {
		slog.Warn("refused", "method", r.Method, "path", r.URL.Path, "err", err)
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	// Go's mux would redirect an unclean path to a clean one at this
	// server's root, outside the gate's prefix; nothing is there anyway.
	if p := r.URL.Path; path.Clean(p) != strings.TrimSuffix(p, "/") && p != "/" {
		http.NotFound(w, r)
		return
	}
	v, err := sp.load(r.Context(), id.space)
	if err != nil {
		slog.Error("space", "space", id.space, "err", err)
		http.Error(w, "this space could not be read; try again shortly", http.StatusBadGateway)
		return
	}
	if v == nil {
		http.NotFound(w, r)
		return
	}
	ctx := withPublicBase(r.Context(), id.prefix)
	ctx = context.WithValue(ctx, requestKey{}, &request{id: id, v: v})
	sp.mux.ServeHTTP(w, r.WithContext(ctx))
}

// find is live's view of a request: the talk in the signed space, led
// by the owners, rate limited by the signed email.
func (sp *spaces) find(r *http.Request) talk {
	req := requestOf(r)
	name := r.PathValue("talk")
	t := talk{
		name: name,
		site: req.v.site,
		lead: sp.owners[req.id.email],
		who:  "e:" + req.id.email,
	}
	if req.v.talks[name] {
		t.room = sp.live.room(roomID(req.id.space, name))
	}
	return t
}

func roomID(space, talk string) string { return space + "/" + talk }

// load is the space's current publish, nil when it has none. It looks
// at the manifest again once recheck has passed since the last look.
func (sp *spaces) load(ctx context.Context, name string) (*version, error) {
	sp.mu.Lock()
	s := sp.byName[name]
	if s == nil {
		s = &space{name: name}
		sp.byName[name] = s
	}
	sp.mu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	now := sp.now()
	if !s.checked.IsZero() && now.Sub(s.checked) < recheck {
		return s.cur.Load(), s.err
	}
	s.checked = now
	// The visitor leaving does not cut the check short for everyone else.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	body, etag, err := sp.store.get(ctx, "spaces/"+name+"/"+manifestFile, s.etag)
	switch {
	case errors.Is(err, errNotModified):
		return s.cur.Load(), nil
	case errors.Is(err, errNotFound):
		s.etag, s.err = "", nil
		sp.swap(s, nil)
		return nil, nil
	case err != nil:
		// Keep serving the last publish through a bucket hiccup.
		if v := s.cur.Load(); v != nil {
			slog.Warn("manifest: keeping the last one", "space", name, "err", err)
			return v, nil
		}
		s.err = err
		return nil, err
	}
	m, err := parseManifest(name, body)
	if err != nil {
		if v := s.cur.Load(); v != nil {
			slog.Error("manifest: keeping the last one", "space", name, "err", err)
			return v, nil
		}
		s.err = err
		return nil, err
	}
	s.etag, s.err = etag, nil
	files := &spaceFiles{sp: sp, space: name, m: m.Files}
	files.modTime, _ = time.Parse(time.RFC3339, m.Version)
	v := &version{site: &site{prefix: "/talks", files: files}, files: files, talks: map[string]bool{}}
	for _, t := range v.site.talks() {
		v.talks[t] = true
	}
	sp.swap(s, v)
	slog.Info("space", "space", name, "version", m.Version, "files", len(m.Files), "talks", len(v.talks))
	return v, nil
}

// swap makes v the space's publish: talks it no longer has lose their
// rooms, and files no space uses any more leave the cache.
func (sp *spaces) swap(s *space, v *version) {
	old := s.cur.Swap(v)
	if old != nil {
		for t := range old.talks {
			if v == nil || !v.talks[t] {
				sp.live.drop(roomID(s.name, t))
			}
		}
	}
	sp.mu.Lock()
	defer sp.mu.Unlock()
	used := map[string]bool{}
	for _, other := range sp.byName {
		if ov := other.cur.Load(); ov != nil {
			for p, e := range ov.files.m {
				used[blobKey(p, e)] = true
			}
		}
	}
	for k := range sp.blobs {
		if !used[k] {
			delete(sp.blobs, k)
		}
	}
}

// blobKey: a file's bytes are shared by every path and space that has
// them, but its content type comes from its name.
func blobKey(p string, e manifestEntry) string { return e.SHA256 + path.Ext(p) }

// blob is the file at p in the space, from the cache or the store.
func (sp *spaces) blob(ctx context.Context, space, p string, e manifestEntry, modTime time.Time) (*file, error) {
	key := blobKey(p, e)
	sp.mu.Lock()
	f := sp.blobs[key]
	sp.mu.Unlock()
	if f != nil {
		return f, nil
	}
	body, _, err := sp.store.get(ctx, "spaces/"+space+"/"+p, "")
	if errors.Is(err, errNotFound) {
		return nil, fmt.Errorf("%s/%s is in the manifest but not in the %s", space, p, sp.store)
	}
	if err != nil {
		return nil, err
	}
	// A publish in progress may have replaced the file before its
	// manifest: refuse it rather than cache the wrong bytes.
	if got := hexSHA256(body); got != e.SHA256 {
		return nil, fmt.Errorf("%s/%s: sha256 %s, manifest says %s", space, p, got[:12], e.SHA256[:12])
	}
	f = newFile(p, body, modTime)
	sp.mu.Lock()
	defer sp.mu.Unlock()
	if cached := sp.blobs[key]; cached != nil {
		return cached, nil
	}
	sp.blobs[key] = f
	return f, nil
}

// writeManifest writes dir/_manifest.json for the files in dir, as
// alethi publish does for the bucket, so a directory can stand in for a
// space in local runs (-spaces-dir).
func writeManifest(dir string) error {
	m := manifest{Version: time.Now().UTC().Format(time.RFC3339), Files: map[string]manifestEntry{}}
	root := os.DirFS(dir)
	err := fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || p == manifestFile {
			return err
		}
		body, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		m.Files[p] = manifestEntry{SHA256: hexSHA256(body), Size: int64(len(body))}
		return nil
	})
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, manifestFile), append(b, '\n'), 0o644)
}
