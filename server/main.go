// Command server serves the talks site that deck publish builds,
// plus a live follow-along for every talk in it. Standard library only:
//
//	bun deck publish
//	go run ./deck/server [-site site] [-addr :8080]
//
// The site: /talks lists the talks and /talks/<talk> is a deck, with clean
// URLs (no .html, no trailing slash). /talks is the default prefix; the
// prefix in deck.config.json moves them, and publish notes it in the site
// (deck-site.json) for this server to read.
//
// Live, per talk:
//
//	GET  /talks/<talk>/live    the deck, following the speaker (the QR code)
//	GET  /talks/<talk>/events  the stream the followers and the lead listen to
//	POST /talks/<talk>/state   the speaker's slide, laser and ink (needs the key)
//	POST /talks/<talk>/react   an audience emoji
//
// The speaker leads by pressing "Go live" in the deck's presenter window,
// which asks for the key once and keeps it in that browser. The key comes
// from DECK_LEAD_KEY, or is made up and printed at startup. Behind a
// proxy, -ip-header (or DECK_IP_HEADER) names the header holding the
// visitor's address, for the rate limits. Followers only
// ever learn the slide, the laser and the ink. All live state is in
// memory, so run one instance.
//
// Spaces mode, when DECK_GATE_SECRET is set: private sites behind
// alethi.dev's gate, read from a bucket (spaces.go). Each request's
// space and email come from the gate's signed X-Gate-* headers (gate.go);
// the owners in DECK_OWNERS lead and read notes without a key. The same
// routes, relative to the space's root:
//
//	DECK_GATE_SECRET=... DECK_OWNERS=you@example.com go run ./deck/server [-spaces-dir dir]
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}

func run() error {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	siteDir := flag.String("site", "site", "the directory deck publish wrote")
	addr := flag.String("addr", ":"+port, "listen address")
	ipHeader := flag.String("ip-header", os.Getenv("DECK_IP_HEADER"),
		"the header a proxy in front puts the visitor's address in, e.g. X-Real-IP (default: trust none, use the peer)")
	spacesDir := flag.String("spaces-dir", "",
		"spaces mode: read the spaces from this directory, laid out like the bucket (spaces/<space>/_manifest.json), instead of the bucket")
	manifestDir := flag.String("write-manifest", "",
		"write <dir>/_manifest.json for the files in <dir> (a space for -spaces-dir), and exit")
	flag.Parse()

	if *manifestDir != "" {
		return writeManifest(*manifestDir)
	}
	if secret := os.Getenv("DECK_GATE_SECRET"); secret != "" {
		sp, err := spacesFromEnv(secret, *spacesDir)
		if err != nil {
			return err
		}
		return serve(*addr, sp, sp.live, func() { announceSpaces(sp, *addr) })
	}
	if *spacesDir != "" {
		return errors.New("-spaces-dir is spaces mode, which needs DECK_GATE_SECRET")
	}

	st, err := loadSite(*siteDir)
	if err != nil {
		return err
	}
	key := os.Getenv("DECK_LEAD_KEY")
	madeUp := key == ""
	if madeUp {
		b := make([]byte, 12)
		_, _ = rand.Read(b)
		key = base64.RawURLEncoding.EncodeToString(b)
	}
	lv, err := newSiteLive(st, options{key: key, ipHeader: *ipHeader})
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	lv.register(mux, st.prefix)
	mux.Handle("/", st)
	return serve(*addr, mux, lv, func() { announce(st, *addr, key, madeUp) })
}

// spacesFromEnv sets up spaces mode: the gate's secret, the owners, and
// the bucket from Railway's variables (or dir, when set).
func spacesFromEnv(secret, dir string) (*spaces, error) {
	if len(secret) < minGateSecret {
		return nil, fmt.Errorf("DECK_GATE_SECRET is %d bytes; want at least %d, the same as the gate's GATE_IDENTITY_SECRET", len(secret), minGateSecret)
	}
	var st store
	if dir != "" {
		d, err := newDirStore(dir)
		if err != nil {
			return nil, err
		}
		st = d
	} else {
		c, err := s3FromEnv()
		if err != nil {
			return nil, err
		}
		if c == nil {
			return nil, fmt.Errorf("spaces mode reads the bucket from %s, %s, %s and %s (or a directory with -spaces-dir)",
				envEndpoint, envBucket, envAccessKey, envSecretKey)
		}
		st = c
	}
	return newSpaces([]byte(secret), parseOwners(os.Getenv("DECK_OWNERS")), st), nil
}

// serve runs h on addr, with lv's reactions, until the process is told
// to stop. hello says what is being served, once it is listening.
func serve(addr string, h http.Handler, lv *live, hello func()) error {
	// Cancelled on shutdown, so the open event streams end and Shutdown
	// does not wait on them.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go lv.run(ctx)

	// No read or write timeout: the event streams stay open for the talk.
	server := &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	errc := make(chan error, 1)
	go func() { errc <- server.ListenAndServe() }()
	hello()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// announceSpaces says where the spaces come from and who leads.
func announceSpaces(sp *spaces, addr string) {
	fmt.Printf("deck server on %s, spaces mode: the spaces in the %s, behind the gate\n", addr, sp.store)
	if len(sp.owners) == 0 {
		fmt.Println("  owners: none (set DECK_OWNERS), so nobody can lead or read notes")
	} else {
		fmt.Printf("  owners: %s\n", strings.Join(slices.Sorted(maps.Keys(sp.owners)), ", "))
	}
	if os.Getenv("DECK_LEAD_KEY") != "" {
		fmt.Println("  DECK_LEAD_KEY is ignored here: the owners lead without a key")
	}
}

// announce prints what to open: the audience URL for each talk on this
// machine's network, and the speaker's deck.
func announce(st *site, addr, key string, madeUp bool) {
	host, port, _ := net.SplitHostPort(addr)
	hosts := []string{}
	if host != "" && host != "0.0.0.0" && host != "::" {
		hosts = append(hosts, host)
	} else if ifaces, err := net.InterfaceAddrs(); err == nil {
		for _, a := range ifaces {
			if ip, ok := a.(*net.IPNet); ok && !ip.IP.IsLoopback() && ip.IP.To4() != nil {
				hosts = append(hosts, ip.IP.String())
			}
		}
	}
	if len(hosts) == 0 {
		hosts = []string{"localhost"}
	}
	names := st.talks()
	fmt.Printf("deck server on %s, %d talk(s)\n", addr, len(names))
	for _, name := range names {
		fmt.Printf("\n  %s\n", name)
		for _, h := range hosts {
			fmt.Printf("    audience  http://%s:%s%s/%s/live\n", h, port, st.prefix, name)
		}
		fmt.Printf("    you       http://127.0.0.1:%s%s/%s, then p and Go live\n", port, st.prefix, name)
	}
	if madeUp {
		fmt.Printf("\n  key: %s (made up for this run; set DECK_LEAD_KEY to keep one)\n", key)
	} else {
		fmt.Println("\n  key: from DECK_LEAD_KEY")
	}
}
