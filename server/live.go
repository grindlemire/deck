package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// reactions are the emojis the audience can send. The follow page gets
// this list, so the server and the buttons never disagree.
var reactions = []string{"👏", "🔥", "😂", "🤯", "❤️", "🤔"}

const (
	maxBatch      = 500   // laser and ink events in one post from the lead
	maxInk        = 20000 // ink events kept for followers who join late
	listenerQueue = 256   // messages queued for a slow listener before it is dropped
	pingEvery     = 20 * time.Second
	reactEvery    = 300 * time.Millisecond
	reactPerFlush = 20 // emojis sent out per flush, for the whole room
	// A phone (by the id its page made up) gets reactRate emojis a second
	// after a burst of reactBurst; an address, which a whole room on one
	// wifi may share, gets addrRate after addrBurst.
	reactRate  = 4
	reactBurst = 8
	addrRate   = 30
	addrBurst  = 60
	// Open event streams, per address (a room on one wifi shares one) and
	// in all, so nobody can hold thousands open.
	maxStreamsPerAddr = 500
	maxStreams        = 5000
	// leadSilence ends a talk whose speaker stopped posting without
	// stopping (a closed tab, a sleeping laptop): the deck posts at least
	// every 10s while live, so phones are not held at the last slide.
	leadSilence = 30 * time.Second
)

// live holds the follow-along rooms, one per talk, and serves them.
// Which talk a request is for, and whether it may lead, is the serving
// mode's call (find): the one published site, led with the key
// (newSiteLive), or a space behind the gate (spaces.go).
type live struct {
	find    func(r *http.Request) talk
	cors    bool // let any origin post: a file:// deck may lead with the key
	mu      sync.Mutex
	rooms   map[string]*room // by an id the mode picks: the talk, or space/talk
	limit   *limiter
	streams *streams
}

// talk is what a live request is for, as the serving mode found it.
type talk struct {
	name string
	room *room  // nil: no such talk
	site *site  // the talk's deck and notes, and the 404 page; nil: none
	lead bool   // may lead the talk and read its notes
	anon bool   // a signed-out follower: only the live talk, as far as it has gone
	who  string // whom the rate limits and stream caps count
}

// room is one talk's follow-along: where the speaker is, the ink on the
// current slide, and everyone listening.
type room struct {
	pageMu   sync.Mutex
	page     *file  // the deck in follow mode,
	pageDeck *file  // built from this deck
	pageAt   string // for the talks at this public path

	// For signed-out followers (anon.go): the deck taken apart, and the
	// shell made from it for the talks at shellAt.
	partsDeck *file
	partsOf   *deckParts
	shell     *file
	shellAt   string

	mu        sync.Mutex
	led       bool      // the lead has posted since the server started
	heard     time.Time // the lead's last post
	state     leadState
	ink       []fx // ink since the slide began or was last cleared
	listeners map[*listener]struct{}
	maxShown  int            // the furthest slide shown since the talk went live; -1 when it is not
	pending   map[string]int // reactions since the last flush
	pendingN  int
}

type listener struct {
	ch   chan []byte
	lead bool
	anon bool // let go, after an "ended" event, when the talk stops
}

// leadState is where the speaker is. Live is false once they stop, which
// lets followers move freely; Clip is a demo clip blown up to full size.
type leadState struct {
	Slide int  `json:"slide"`
	Phase int  `json:"phase"`
	Live  bool `json:"live"`
	Clip  bool `json:"clip,omitempty"`
}

// fx is one laser or ink event from the lead, in slide fractions. D is
// its offset in ms within the batch, so followers replay it at the pace
// it was drawn. A laser event with no x and y lifts the pointer; S starts
// an ink stroke; C is the color.
type fx struct {
	D int      `json:"d"`
	T string   `json:"t"`
	X *float64 `json:"x"`
	Y *float64 `json:"y"`
	S bool     `json:"s,omitempty"`
	C string   `json:"c,omitempty"`
}

var colorRE = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (e fx) valid() bool {
	if e.D < 0 || e.D > 10000 || (e.C != "" && !colorRE.MatchString(e.C)) {
		return false
	}
	on := func(p *float64) bool { return p != nil && *p >= 0 && *p <= 1 }
	switch e.T {
	case "clear":
		return true
	case "laser":
		return (e.X == nil && e.Y == nil) || (on(e.X) && on(e.Y))
	case "ink":
		return on(e.X) && on(e.Y)
	}
	return false
}

type fxMsg struct {
	Slide  int  `json:"slide"`
	Replay bool `json:"replay,omitempty"`
	Events []fx `json:"events"`
}

func newLive(find func(*http.Request) talk, cors bool) *live {
	return &live{
		find:    find,
		cors:    cors,
		rooms:   map[string]*room{},
		limit:   newLimiter(),
		streams: &streams{byAddr: map[string]int{}, perAddr: maxStreamsPerAddr, max: maxStreams},
	}
}

// options are the single-site mode's settings (main.go reads them from
// flags and the environment).
type options struct {
	key      string // leads a talk and reads its notes
	ipHeader string // see clientIP; empty trusts no header
}

// newSiteLive is the follow-along for one published site: a room for
// each talk in it, led with the key, rate limited by address.
func newSiteLive(st *site, opt options) (*live, error) {
	key := []byte(opt.key)
	lv := newLive(nil, true)
	lv.find = func(r *http.Request) talk {
		name := r.PathValue("talk")
		got, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		return talk{
			name: name,
			room: lv.lookup(name),
			site: st,
			lead: subtle.ConstantTimeCompare([]byte(got), key) == 1,
			who:  clientIP(r, opt.ipHeader),
		}
	}
	for _, name := range st.talks() {
		deck, _ := st.deck(context.Background(), name)
		// Built now, so a deck the follow page cannot be made from stops
		// the server at startup.
		if _, err := lv.room(name).followPage(st.prefix, name, deck); err != nil {
			return nil, err
		}
	}
	return lv, nil
}

// room is the room under id, made on first use.
func (lv *live) room(id string) *room {
	lv.mu.Lock()
	defer lv.mu.Unlock()
	rm := lv.rooms[id]
	if rm == nil {
		rm = &room{listeners: map[*listener]struct{}{}, pending: map[string]int{}, maxShown: -1}
		lv.rooms[id] = rm
	}
	return rm
}

// lookup is the room under id, nil when there is none.
func (lv *live) lookup(id string) *room {
	lv.mu.Lock()
	defer lv.mu.Unlock()
	return lv.rooms[id]
}

// drop ends the room under id, for a talk that is no longer published:
// everyone listening is let go.
func (lv *live) drop(id string) {
	lv.mu.Lock()
	rm := lv.rooms[id]
	delete(lv.rooms, id)
	lv.mu.Unlock()
	if rm != nil {
		rm.mu.Lock()
		for l := range rm.listeners {
			rm.dropLocked(l)
		}
		rm.mu.Unlock()
	}
}

// followPage is the deck in follow mode for the talks at prefix (the
// path the browser sees), built once per deck and prefix.
func (rm *room) followPage(prefix, name string, deck *file) (*file, error) {
	rm.pageMu.Lock()
	defer rm.pageMu.Unlock()
	if rm.page != nil && rm.pageDeck == deck && rm.pageAt == prefix {
		return rm.page, nil
	}
	page, err := followPage(prefix, name, deck)
	if err != nil {
		return nil, err
	}
	rm.page, rm.pageDeck, rm.pageAt = page, deck, prefix
	return page, nil
}

// followPage is the deck with the follow-along settings put first in its
// head: where to listen, which reactions to offer, and a phone viewport
// (the slide scales to any viewport; the buttons need real pixels).
func followPage(prefix, name string, deck *file) (*file, error) {
	events, err := json.Marshal(prefix + "/" + name + "/events")
	if err != nil {
		return nil, err
	}
	emojis, err := json.Marshal(reactions)
	if err != nil {
		return nil, err
	}
	script := fmt.Appendf(nil, "\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<script>window.DECK_FOLLOW = %s; window.DECK_REACTIONS = %s;</script>", events, emojis)
	body := deck.body
	at := bytes.Index(bytes.ToLower(body), []byte("<head>"))
	if at < 0 {
		return nil, fmt.Errorf("%s/%s/index.html has no <head>", prefix, name)
	}
	at += len("<head>")
	page := slices.Concat(body[:at], script, body[at:])
	return newFile("index.html", page, deck.modTime), nil
}

// register serves the talks under prefix (the path on this server).
func (lv *live) register(mux *http.ServeMux, prefix string) {
	at := func(method, rest string) string { return method + " " + prefix + "/{talk}/" + rest }
	mux.HandleFunc(at("GET", "live"), lv.servePage)
	mux.HandleFunc(at("GET", "events"), lv.serveEvents)
	mux.HandleFunc(at("POST", "state"), lv.serveLead)
	if lv.cors {
		mux.HandleFunc(at("OPTIONS", "state"), lv.servePreflight)
	}
	mux.HandleFunc(at("POST", "react"), lv.serveReact)
	mux.HandleFunc(at("GET", "notes"), lv.serveNotes)
	mux.HandleFunc(at("GET", "slides"), lv.serveSlides)
}

// run sends out the reactions in batches until ctx ends.
func (lv *live) run(ctx context.Context) {
	tick := time.NewTicker(reactEvery)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			lv.mu.Lock()
			rooms := slices.Collect(maps.Values(lv.rooms))
			lv.mu.Unlock()
			for _, rm := range rooms {
				rm.flushReactions()
				rm.endIfSilent(now, leadSilence)
			}
			lv.limit.sweep(now)
		}
	}
}

// found is the request's talk, or a 404 (and nil) when there is none.
func (lv *live) found(w http.ResponseWriter, r *http.Request) (talk, bool) {
	t := lv.find(r)
	if t.room == nil {
		http.NotFound(w, r)
	}
	return t, t.room != nil
}

func (lv *live) servePage(w http.ResponseWriter, r *http.Request) {
	// People reach this page from a QR code: a talk that is not here
	// gets the site's 404 page, as any other missing page does.
	t := lv.find(r)
	var deck *file
	if t.room != nil {
		var err error
		if deck, err = t.site.deck(r.Context(), t.name); err != nil {
			unavailable(w, t.name, err)
			return
		}
	}
	if deck == nil {
		if t.site != nil {
			t.site.notFound(w, r)
		} else {
			http.NotFound(w, r)
		}
		return
	}
	if t.anon {
		lv.serveAnonPage(w, r, t, deck)
		return
	}
	page, err := t.room.followPage(publicBase(r.Context())+t.site.prefix, t.name, deck)
	if err != nil {
		slog.Error("follow page", "talk", t.name, "err", err)
		http.Error(w, "this deck cannot be followed", http.StatusInternalServerError)
		return
	}
	setSiteHeaders(w.Header())
	w.Header().Set("Cache-Control", "no-cache")
	page.serve(w, r)
}

// The lead may be a file:// page (origin "null"), so any origin may post;
// the key is what guards moving the slides.
func cors(h http.Header) {
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "authorization, content-type")
}

func (lv *live) servePreflight(w http.ResponseWriter, r *http.Request) {
	cors(w.Header())
	w.WriteHeader(http.StatusNoContent)
}

// serveLead takes the speaker's slide and any laser and ink since the
// last post, and answers with how many are following.
func (lv *live) serveLead(w http.ResponseWriter, r *http.Request) {
	if lv.cors {
		cors(w.Header())
	}
	t, ok := lv.found(w, r)
	if !ok {
		return
	}
	if !t.lead {
		http.Error(w, "not allowed to lead this talk", http.StatusForbidden)
		return
	}
	rm := t.room
	var in struct {
		Slide  *int  `json:"slide"`
		Phase  *int  `json:"phase"`
		Live   *bool `json:"live"`
		Clip   bool  `json:"clip"`
		Events []fx  `json:"events"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if in.Slide == nil || *in.Slide < 0 || in.Phase == nil || *in.Phase < 1 || len(in.Events) > maxBatch {
		http.Error(w, "want {slide, phase, events}", http.StatusBadRequest)
		return
	}
	for _, e := range in.Events {
		if !e.valid() {
			http.Error(w, "bad event", http.StatusBadRequest)
			return
		}
	}
	live := in.Live == nil || *in.Live
	n := rm.lead(leadState{Slide: *in.Slide, Phase: *in.Phase, Live: live, Clip: in.Clip}, in.Events)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]int{"followers": n})
}

// serveEvents streams the room to one follower (or, with ?lead, to the
// speaker's deck, which shows the reactions).
func (lv *live) serveEvents(w http.ResponseWriter, r *http.Request) {
	t, ok := lv.found(w, r)
	if !ok {
		return
	}
	if !lv.streams.open(t.who) {
		http.Error(w, "too many open streams", http.StatusServiceUnavailable)
		return
	}
	defer lv.streams.close(t.who)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	if lv.cors {
		h.Set("Access-Control-Allow-Origin", "*")
	}
	h.Set("X-Accel-Buffering", "no")
	rm := t.room
	l := rm.join(r.URL.Query().Has("lead") && !t.anon, t.anon)
	if l == nil {
		http.Error(w, "the talk is not live", http.StatusForbidden)
		return
	}
	defer rm.leave(l)

	rc := http.NewResponseController(w)
	w.WriteHeader(http.StatusOK)
	if rc.Flush() != nil {
		return
	}
	ping := time.NewTicker(pingEvery)
	defer ping.Stop()
	for {
		var msg []byte
		select {
		case <-r.Context().Done():
			return
		case m, ok := <-l.ch:
			if !ok {
				return // too slow: dropped; the browser reconnects
			}
			msg = m
		case <-ping.C:
			// A comment keeps idle connections and proxies open.
			msg = []byte(": ping\n\n")
		}
		if _, err := w.Write(msg); err != nil || rc.Flush() != nil {
			return
		}
	}
}

func (lv *live) serveReact(w http.ResponseWriter, r *http.Request) {
	t, ok := lv.found(w, r)
	if !ok {
		return
	}
	var in struct {
		E string `json:"e"`
		P string `json:"p"` // the phone: an id its page made up
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in); err != nil || !slices.Contains(reactions, in.E) || len(in.P) > 32 {
		http.Error(w, "want {e, p} with one of the offered emojis", http.StatusBadRequest)
		return
	}
	if _, live := t.room.shown(); t.anon && !live {
		http.Error(w, "the talk is not live", http.StatusForbidden)
		return
	}
	now := time.Now()
	if (in.P != "" && !lv.limit.allow("p:"+in.P, now, reactRate, reactBurst)) || !lv.limit.allow("a:"+t.who, now, addrRate, addrBurst) {
		http.Error(w, "slow down", http.StatusTooManyRequests)
		return
	}
	t.room.react(in.E)
	w.WriteHeader(http.StatusNoContent)
}

// clientIP is the visitor's address, which the rate limits and stream
// caps key on. Behind a proxy, header names where the proxy puts the
// address it accepted (X-Real-IP on Railway, Fly-Client-IP on Fly,
// CF-Connecting-IP behind Cloudflare). Trust a header only when every
// request comes through that proxy: anyone who reaches the server
// directly can send it. With no header, or a header that is not an
// address, it is the peer.
func clientIP(r *http.Request, header string) string {
	if header != "" {
		if ip, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get(header))); err == nil {
			return ip.Unmap().String()
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

/* ---------- the room ---------- */

func sse(event string, v any) []byte {
	data, _ := json.Marshal(v)
	return fmt.Appendf(nil, "event: %s\ndata: %s\n\n", event, data)
}

// join adds a listener, queued up with where the talk is and the ink
// already on the slide. A signed-out follower (anon) joins only a live
// talk: nil otherwise.
func (rm *room) join(lead, anon bool) *listener {
	l := &listener{ch: make(chan []byte, listenerQueue), lead: lead, anon: anon}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if anon && !rm.liveLocked() {
		return nil
	}
	if rm.led {
		l.ch <- sse("state", rm.state)
		if len(rm.ink) > 0 {
			l.ch <- sse("fx", fxMsg{Slide: rm.state.Slide, Replay: true, Events: rm.ink})
		}
	}
	rm.listeners[l] = struct{}{}
	return l
}

func (rm *room) leave(l *listener) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.dropLocked(l)
}

func (rm *room) dropLocked(l *listener) {
	if _, ok := rm.listeners[l]; ok {
		delete(rm.listeners, l)
		close(l.ch)
	}
}

// broadcastLocked queues msg for everyone; a listener whose queue is
// full is dropped rather than slowing the room.
func (rm *room) broadcastLocked(msg []byte) {
	for l := range rm.listeners {
		select {
		case l.ch <- msg:
		default:
			rm.dropLocked(l)
		}
	}
}

func (rm *room) followersLocked() int {
	n := 0
	for l := range rm.listeners {
		if !l.lead {
			n++
		}
	}
	return n
}

// lead applies a post from the speaker: the slide first, then the laser
// and ink, so followers draw on the right slide.
// endIfSilent ends a live talk the lead has not posted to for longer
// than after, as if the speaker had pressed Stop.
func (rm *room) endIfSilent(now time.Time, after time.Duration) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if !rm.led || !rm.state.Live || now.Sub(rm.heard) <= after {
		return
	}
	rm.state.Live = false
	rm.state.Clip = false
	rm.broadcastLocked(sse("state", rm.state))
	rm.endedLocked()
}

func (rm *room) liveLocked() bool { return rm.led && rm.state.Live }

// shown is how far the speaker has gone in this live session, and
// whether the talk is live.
func (rm *room) shown() (int, bool) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.maxShown, rm.liveLocked()
}

// endedLocked closes the live session: the slides shown are forgotten,
// and signed-out followers hear that the talk ended and are let go.
func (rm *room) endedLocked() {
	rm.maxShown = -1
	ended := sse("ended", struct{}{})
	for l := range rm.listeners {
		if !l.anon {
			continue
		}
		select {
		case l.ch <- ended:
		default:
		}
		rm.dropLocked(l)
	}
}

func (rm *room) lead(s leadState, events []fx) int {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.heard = time.Now()
	if !rm.led || s.Slide != rm.state.Slide {
		rm.ink = nil
	}
	if s.Live {
		rm.maxShown = max(rm.maxShown, s.Slide)
	}
	if !rm.led || s != rm.state {
		rm.led = true
		rm.state = s
		rm.broadcastLocked(sse("state", s))
	}
	if !s.Live {
		rm.endedLocked()
	}
	if len(events) > 0 {
		for _, e := range events {
			switch {
			case e.T == "clear":
				rm.ink = nil
			case e.T == "ink" && len(rm.ink) < maxInk:
				rm.ink = append(rm.ink, e)
			}
		}
		rm.broadcastLocked(sse("fx", fxMsg{Slide: s.Slide, Events: events}))
	}
	return rm.followersLocked()
}

func (rm *room) react(emoji string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.pendingN < reactPerFlush {
		rm.pending[emoji]++
		rm.pendingN++
	}
}

func (rm *room) flushReactions() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.pendingN == 0 {
		return
	}
	rm.broadcastLocked(sse("react", map[string]any{"counts": rm.pending}))
	rm.pending = map[string]int{}
	rm.pendingN = 0
}

/* ---------- rate limit: a token bucket per address ---------- */

type limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newLimiter() *limiter { return &limiter{buckets: map[string]*bucket{}} }

func (l *limiter) allow(key string, now time.Time, rate, burst float64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = min(burst, b.tokens+now.Sub(b.last).Seconds()*rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// sweep forgets addresses that have been quiet for a minute.
func (l *limiter) sweep(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, b := range l.buckets {
		if now.Sub(b.last) > time.Minute {
			delete(l.buckets, k)
		}
	}
}

// streams counts the open event streams, by address and in all.
type streams struct {
	mu           sync.Mutex
	byAddr       map[string]int
	total        int
	perAddr, max int
}

func (s *streams) open(addr string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.total >= s.max || s.byAddr[addr] >= s.perAddr {
		return false
	}
	s.byAddr[addr]++
	s.total++
	return true
}

func (s *streams) close(addr string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.byAddr[addr]--; s.byAddr[addr] <= 0 {
		delete(s.byAddr, addr)
	}
	s.total--
}

// serveNotes hands the speaker notes to the lead only: the published
// deck leaves them out, so the presenter window fetches them.
func (lv *live) serveNotes(w http.ResponseWriter, r *http.Request) {
	t, ok := lv.found(w, r)
	if !ok {
		return
	}
	if !t.lead {
		http.Error(w, "not allowed to read these notes", http.StatusForbidden)
		return
	}
	notes, err := t.site.notes(r.Context(), t.name)
	if err != nil {
		unavailable(w, t.name+" notes", err)
		return
	}
	if notes == nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(notes)
}
