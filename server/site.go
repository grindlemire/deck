package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"maps"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// file is one published file, held in memory with its gzip form. The
// site is a few self-contained deck pages, so it all fits.
type file struct {
	body    []byte
	gz      []byte // nil when gzip does not pay
	ctype   string
	etag    string
	modTime time.Time
}

func newFile(name string, body []byte, modTime time.Time) *file {
	f := &file{body: body, modTime: modTime}
	f.ctype = mime.TypeByExtension(path.Ext(name))
	if f.ctype == "" {
		f.ctype = http.DetectContentType(body)
	}
	sum := sha256.Sum256(body)
	f.etag = `"` + hex.EncodeToString(sum[:8]) + `"`
	if compressible(f.ctype) {
		var b bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&b, gzip.BestCompression)
		_, _ = zw.Write(body)
		_ = zw.Close()
		if b.Len() < len(body) {
			f.gz = b.Bytes()
		}
	}
	return f
}

func compressible(ctype string) bool {
	return strings.HasPrefix(ctype, "text/") ||
		strings.Contains(ctype, "javascript") ||
		strings.Contains(ctype, "json") ||
		strings.Contains(ctype, "svg") ||
		strings.Contains(ctype, "xml")
}

// serve writes f, gzipped when the client takes it.
func (f *file) serve(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Type", f.ctype)
	h.Set("Vary", "Accept-Encoding")
	body, etag := f.body, f.etag
	if f.gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		body, etag = f.gz, strings.TrimSuffix(f.etag, `"`)+`-gz"`
	}
	h.Set("ETag", etag)
	http.ServeContent(w, r, "", f.modTime, bytes.NewReader(body))
}

// files is what a site serves, by slash path relative to its root: a
// published directory held in memory, or a space's manifest whose files
// are fetched when first asked for. open answers nil, nil for a path
// that is not there; paths lists every file.
type files interface {
	open(ctx context.Context, p string) (*file, error)
	paths() []string
}

// memFiles is a directory read into memory (loadSite).
type memFiles map[string]*file

func (m memFiles) open(_ context.Context, p string) (*file, error) { return m[p], nil }
func (m memFiles) paths() []string                                 { return slices.Collect(maps.Keys(m)) }

// site serves deck publish output the way the hosts before it did:
// /x/index.html, /x.html and /x/ redirect to /x, and /x serves
// x/index.html, x.html or x, in that order.
type site struct {
	prefix string // where the talks are: "/talks", or "" at the root
	files  files
}

// siteFile is publish.mjs's note on the site it wrote: {"prefix": ...}.
// Without it the talks are under /talks.
const siteFile = "deck-site.json"

// servable says whether p may be served as a file: a talk's speaker
// notes go only to the lead (see serveNotes), and deck-site.json is the
// server's.
func servable(p string) bool {
	return path.Base(p) != "notes.json" && p != siteFile
}

func loadSite(dir string) (*site, error) {
	mem := memFiles{}
	s := &site{prefix: "/talks", files: mem}
	root := os.DirFS(dir)
	if b, err := fs.ReadFile(root, siteFile); err == nil {
		var meta struct {
			Prefix *string `json:"prefix"`
		}
		if err := json.Unmarshal(b, &meta); err != nil {
			return nil, fmt.Errorf("%s: %w", filepath.Join(dir, siteFile), err)
		}
		if meta.Prefix != nil {
			s.prefix = *meta.Prefix
		}
		if !validPrefix(s.prefix) {
			return nil, fmt.Errorf("%s: prefix %q is not a path like /talks (or empty)", filepath.Join(dir, siteFile), s.prefix)
		}
	}
	err := fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || p == siteFile {
			return err
		}
		body, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		mem[p] = newFile(p, body, info.ModTime())
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("load %s: %w (run bun deck publish first)", filepath.Clean(dir), err)
	}
	if list := s.talkPath("index.html"); mem[list] == nil {
		return nil, fmt.Errorf("%s has no %s (run bun deck publish first)", filepath.Clean(dir), list)
	}
	return s, nil
}

// validPrefix: empty, or a clean path with no trailing slash.
func validPrefix(p string) bool {
	return p == "" || (p != "/" && path.Clean(p) == p && strings.HasPrefix(p, "/"))
}

// talkPath is the file at rel under the talks, relative to the site root.
func (s *site) talkPath(rel string) string {
	return strings.TrimPrefix(s.prefix+"/"+rel, "/")
}

// talks names every published deck, <prefix>/<name>/index.html, sorted.
func (s *site) talks() []string {
	var names []string
	for _, p := range s.files.paths() {
		rest, ok := strings.CutPrefix(p, s.talkPath(""))
		if !ok {
			continue
		}
		if name, ok := strings.CutSuffix(rest, "/index.html"); ok && name != "" && !strings.Contains(name, "/") {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	return names
}

// deck is the talk's page, nil when there is no such talk.
func (s *site) deck(ctx context.Context, talk string) (*file, error) {
	return s.files.open(ctx, s.talkPath(talk+"/index.html"))
}

// notes is the talk's notes.json, nil when it has none.
func (s *site) notes(ctx context.Context, talk string) ([]byte, error) {
	f, err := s.files.open(ctx, s.talkPath(talk+"/notes.json"))
	if f == nil || err != nil {
		return nil, err
	}
	return f.body, nil
}

func setSiteHeaders(h http.Header) {
	h.Set("Cache-Control", "public, max-age=0, must-revalidate")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
}

func (s *site) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	setSiteHeaders(w.Header())
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p := r.URL.Path
	if to, ok := canonical(p); ok {
		to = publicBase(r.Context()) + to
		if r.URL.RawQuery != "" {
			to += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, to, http.StatusPermanentRedirect)
		return
	}
	name := strings.TrimPrefix(path.Clean(p), "/")
	candidates := []string{path.Join(name, "index.html"), name + ".html", name}
	if name == "" {
		candidates = []string{"index.html"}
	}
	for _, c := range candidates {
		if !servable(c) {
			continue
		}
		f, err := s.files.open(r.Context(), c)
		if err != nil {
			unavailable(w, c, err)
			return
		}
		if f != nil {
			f.serve(w, r)
			return
		}
	}
	s.notFound(w, r)
}

type baseKey struct{}

// withPublicBase notes the path the browser reaches this server under,
// when a proxy in front strips one (spaces mode: X-Gate-Prefix), for the
// URLs the server writes: redirects and the follow page's.
func withPublicBase(ctx context.Context, base string) context.Context {
	return context.WithValue(ctx, baseKey{}, base)
}

func publicBase(ctx context.Context) string {
	b, _ := ctx.Value(baseKey{}).(string)
	return b
}

// unavailable answers for a file that is there but could not be read
// (the bucket did not answer).
func unavailable(w http.ResponseWriter, p string, err error) {
	slog.Error("read", "path", p, "err", err)
	http.Error(w, "this page could not be read; try again shortly", http.StatusBadGateway)
}

// notFound answers with the site's 404.html (publish writes one), else
// Go's plain answer.
func (s *site) notFound(w http.ResponseWriter, r *http.Request) {
	f, _ := s.files.open(r.Context(), "404.html")
	if f == nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", f.ctype)
	w.WriteHeader(http.StatusNotFound)
	if r.Method != http.MethodHead {
		_, _ = w.Write(f.body)
	}
}

// canonical says where a non-canonical path redirects to.
func canonical(p string) (string, bool) {
	switch {
	case p == "/index.html":
		return "/", true
	case len(p) > len("/index.html") && strings.HasSuffix(p, "/index.html"):
		return strings.TrimSuffix(p, "/index.html"), true
	case len(p) > len(".html") && strings.HasSuffix(p, ".html") && !strings.HasSuffix(p, "/.html"):
		return strings.TrimSuffix(p, ".html"), true
	case len(p) > 1 && strings.HasSuffix(p, "/"):
		if t := strings.TrimRight(p, "/"); t != "" {
			return t, true
		}
		return "/", true
	}
	return "", false
}
