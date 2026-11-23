package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
)

// parts is the room's deck taken apart, made once per deck.
func (rm *room) parts(deck *file) (*deckParts, error) {
	rm.pageMu.Lock()
	defer rm.pageMu.Unlock()
	if rm.partsDeck == deck && rm.partsOf != nil {
		return rm.partsOf, nil
	}
	d, err := splitDeck(deck.body)
	if err != nil {
		return nil, err
	}
	rm.partsDeck, rm.partsOf, rm.shell, rm.shellAt = deck, d, nil, ""
	return d, nil
}

// anonPage is the shell for the talks at prefix, made once per deck.
func (rm *room) anonPage(prefix, name string, deck *file) (*file, error) {
	d, err := rm.parts(deck)
	if err != nil {
		return nil, err
	}
	rm.pageMu.Lock()
	defer rm.pageMu.Unlock()
	if rm.shell != nil && rm.shellAt == prefix && rm.partsOf == d {
		return rm.shell, nil
	}
	shell, err := anonShell(d, prefix, name)
	if err != nil {
		return nil, err
	}
	rm.shell, rm.shellAt = shell, prefix
	return shell, nil
}

// serveAnonPage is /live for a signed-out follower.
func (lv *live) serveAnonPage(w http.ResponseWriter, r *http.Request, t talk, deck *file) {
	setSiteHeaders(w.Header())
	w.Header().Set("Cache-Control", "no-store")
	if _, live := t.room.shown(); !live {
		notLivePage.serve(w, r)
		return
	}
	page, err := t.room.anonPage(publicBase(r.Context())+t.site.prefix, t.name, deck)
	if err != nil {
		slog.Error("follow shell", "talk", t.name, "err", err)
		http.Error(w, "this deck cannot be followed", http.StatusInternalServerError)
		return
	}
	page.serve(w, r)
}

// serveSlides hands out the slides from the first through ?upto (or as
// far as the speaker has gone, if less), while the talk is live.
func (lv *live) serveSlides(w http.ResponseWriter, r *http.Request) {
	t, ok := lv.found(w, r)
	if !ok {
		return
	}
	maxShown, live := t.room.shown()
	if !live {
		http.Error(w, "the talk is not live", http.StatusForbidden)
		return
	}
	upto := maxShown
	if q := r.URL.Query().Get("upto"); q != "" {
		n, err := strconv.Atoi(q)
		if err != nil || n < 0 {
			http.Error(w, "want ?upto=<slide index>", http.StatusBadRequest)
			return
		}
		upto = min(n, maxShown)
	}
	deck, err := t.site.deck(r.Context(), t.name)
	if err != nil || deck == nil {
		unavailable(w, t.name, cmpOr(err, errNotFound))
		return
	}
	d, err := t.room.parts(deck)
	if err != nil {
		slog.Error("slides", "talk", t.name, "err", err)
		http.Error(w, "this deck cannot be followed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_ = json.NewEncoder(w).Encode(d.reply(upto))
}

func cmpOr(err, or error) error {
	if err != nil {
		return err
	}
	return or
}
