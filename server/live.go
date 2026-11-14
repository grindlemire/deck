package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
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

// live holds one room per published talk.
type live struct {
	prefix   string // where the talks are; see site.prefix
	key      []byte
	ipHeader string // the header a trusted proxy puts the visitor's address in
	names   []string
	rooms   map[string]*room
	limit   *limiter
	streams *streams
}

// room is one talk's follow-along: where the speaker is, the ink on the
// current slide, and everyone listening.
type room struct {
	page  *file  // the deck in follow mode
	notes []byte // the speaker notes (notes.json), for the key only

	mu        sync.Mutex
	led       bool      // the lead has posted since the server started
	heard     time.Time // the lead's last post
	state     leadState
	ink       []fx // ink since the slide began or was last cleared
	listeners map[*listener]struct{}
	pending   map[string]int // reactions since the last flush
	pendingN  int
}

type listener struct {
	ch   chan []byte
	lead bool
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

// options are the server's settings (main.go reads them from flags
// and the environment).
type options struct {
	key      string // leads a talk and reads its notes
	ipHeader string // see clientIP; empty trusts no header
}

func newLive(st *site, opt options) (*live, error) {
	lv := &live{
		prefix:   st.prefix,
		key:      []byte(opt.key),
		ipHeader: opt.ipHeader,
		rooms:   map[string]*room{},
		limit:   newLimiter(),
		streams: &streams{byAddr: map[string]int{}, perAddr: maxStreamsPerAddr, max: maxStreams},
	}
	for name, deck := range st.talks() {
		page, err := followPage(st.prefix, name, deck)
		if err != nil {
			return nil, err
		}
		lv.rooms[name] = &room{
			page:      page,
			notes:     st.private[st.talkPath(name+"/notes.json")],
			listeners: map[*listener]struct{}{},
			pending:   map[string]int{},
		}
		lv.names = append(lv.names, name)
	}
	slices.Sort(lv.names)
	return lv, nil
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

func (lv *live) register(mux *http.ServeMux) {
	at := func(method, rest string) string { return method + " " + lv.prefix + "/{talk}/" + rest }
	mux.HandleFunc(at("GET", "live"), lv.servePage)
	mux.HandleFunc(at("GET", "events"), lv.serveEvents)
	mux.HandleFunc(at("POST", "state"), lv.serveLead)
	mux.HandleFunc(at("OPTIONS", "state"), lv.servePreflight)
	mux.HandleFunc(at("POST", "react"), lv.serveReact)
	mux.HandleFunc(at("GET", "notes"), lv.serveNotes)
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
			for _, rm := range lv.rooms {
				rm.flushReactions()
				rm.endIfSilent(now, leadSilence)
			}
			lv.limit.sweep(now)
		}
	}
}

func (lv *live) room(w http.ResponseWriter, r *http.Request) *room {
	rm := lv.rooms[r.PathValue("talk")]
	if rm == nil {
		http.NotFound(w, r)
	}
	return rm
}

func (lv *live) servePage(w http.ResponseWriter, r *http.Request) {
	rm := lv.room(w, r)
	if rm == nil {
		return
	}
	setSiteHeaders(w.Header())
	w.Header().Set("Cache-Control", "no-cache")
	rm.page.serve(w, r)
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

func (lv *live) keyOK(r *http.Request) bool {
	got, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return subtle.ConstantTimeCompare([]byte(got), lv.key) == 1
}

// serveLead takes the speaker's slide and any laser and ink since the
// last post, and answers with how many are following.
func (lv *live) serveLead(w http.ResponseWriter, r *http.Request) {
	cors(w.Header())
	rm := lv.room(w, r)
	if rm == nil {
		return
	}
	if !lv.keyOK(r) {
		http.Error(w, "wrong key", http.StatusForbidden)
		return
	}
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
	rm := lv.room(w, r)
	if rm == nil {
		return
	}
	addr := clientIP(r, lv.ipHeader)
	if !lv.streams.open(addr) {
		http.Error(w, "too many open streams", http.StatusServiceUnavailable)
		return
	}
	defer lv.streams.close(addr)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("X-Accel-Buffering", "no")
	l := rm.join(r.URL.Query().Has("lead"))
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
	rm := lv.room(w, r)
	if rm == nil {
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
	now := time.Now()
	if (in.P != "" && !lv.limit.allow("p:"+in.P, now, reactRate, reactBurst)) || !lv.limit.allow("a:"+clientIP(r, lv.ipHeader), now, addrRate, addrBurst) {
		http.Error(w, "slow down", http.StatusTooManyRequests)
		return
	}
	rm.react(in.E)
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
// already on the slide.
func (rm *room) join(lead bool) *listener {
	l := &listener{ch: make(chan []byte, listenerQueue), lead: lead}
	rm.mu.Lock()
	defer rm.mu.Unlock()
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
}

func (rm *room) lead(s leadState, events []fx) int {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.heard = time.Now()
	if !rm.led || s.Slide != rm.state.Slide {
		rm.ink = nil
	}
	if !rm.led || s != rm.state {
		rm.led = true
		rm.state = s
		rm.broadcastLocked(sse("state", s))
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

// serveNotes hands the speaker notes to the key only: the published deck
// leaves them out, so the presenter window fetches them.
func (lv *live) serveNotes(w http.ResponseWriter, r *http.Request) {
	rm := lv.room(w, r)
	if rm == nil {
		return
	}
	if !lv.keyOK(r) {
		http.Error(w, "wrong key", http.StatusForbidden)
		return
	}
	if rm.notes == nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(rm.notes)
}
