package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// In spaces mode every request comes through alethi.dev's gate, which
// signs who is asking and for which space in X-Gate-* headers. The
// server trusts nothing else: the space comes only from X-Gate-Space,
// never from the path.
const (
	hdrSpace     = "X-Gate-Space"
	hdrPrefix    = "X-Gate-Prefix"
	hdrEmail     = "X-Gate-Email"
	hdrTime      = "X-Gate-Time"
	hdrSignature = "X-Gate-Signature"

	// gateSkew is how far a signature's time may be from the server's.
	gateSkew = 120 * time.Second
	// minGateSecret matches the gate's own minimum for GATE_IDENTITY_SECRET.
	minGateSecret = 32
)

// identity is a request's signed gate headers.
type identity struct {
	space  string // the gate's ID, e.g. nqs-review
	prefix string // the gate's public path, e.g. /p/qmdjrq74 (no trailing slash)
	email  string // who signed in, lowercase; empty for a signed-out follower
}

// anon is a signed-out follower: the gate signed the request with no email.
func (id identity) anon() bool { return id.email == "" }

// spaceRE is a space name that is safe as one path segment in the bucket.
var spaceRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)

// gateSignature is the gate's HMAC over the request: base64url, no padding,
// of HMAC-SHA256(secret, "v1\n" space "\n" prefix "\n" email "\n" time "\n"
// METHOD "\n" path), where path is the request path after the gate took
// its prefix off.
func gateSignature(secret []byte, space, prefix, email, unix, method, path string) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte("v1\n" + space + "\n" + prefix + "\n" + email + "\n" + unix + "\n" + method + "\n" + path))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

var errGate = errors.New("gate headers")

// verifyGate checks the request's gate headers against secret and the
// time now, and returns who it is for.
func verifyGate(secret []byte, r *http.Request, now time.Time) (identity, error) {
	var vals [5]string
	for i, k := range []string{hdrSpace, hdrPrefix, hdrEmail, hdrTime, hdrSignature} {
		vs := r.Header.Values(k)
		if len(vs) != 1 {
			return identity{}, fmt.Errorf("%w: want one %s, got %d", errGate, k, len(vs))
		}
		vals[i] = vs[0]
	}
	space, prefix, email, unix, sig := vals[0], vals[1], vals[2], vals[3], vals[4]
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return identity{}, fmt.Errorf("%w: signature is not base64url", errGate)
	}
	want, _ := base64.RawURLEncoding.DecodeString(gateSignature(secret, space, prefix, email, unix, r.Method, r.URL.Path))
	if !hmac.Equal(got, want) {
		return identity{}, fmt.Errorf("%w: bad signature", errGate)
	}
	t, err := strconv.ParseInt(unix, 10, 64)
	if err != nil {
		return identity{}, fmt.Errorf("%w: time %q is not unix seconds", errGate, unix)
	}
	if d := now.Sub(time.Unix(t, 0)); d > gateSkew || d < -gateSkew {
		return identity{}, fmt.Errorf("%w: signed %s off the server's clock", errGate, d.Abs().Round(time.Second))
	}
	// Signed, so these are the gate's; checked anyway, since the space
	// names a folder in the bucket and the prefix goes into pages.
	if !spaceRE.MatchString(space) {
		return identity{}, fmt.Errorf("%w: space %q is not a name", errGate, space)
	}
	if !validPrefix(prefix) {
		return identity{}, fmt.Errorf("%w: prefix %q is not a path like /p/x", errGate, prefix)
	}
	// An empty email is still signed: the gate let someone who is not
	// signed in through to a public path (a signed-out follower).
	return identity{space: space, prefix: prefix, email: strings.ToLower(email)}, nil
}

// parseOwners reads DECK_OWNERS: emails, comma-separated.
func parseOwners(s string) map[string]bool {
	owners := map[string]bool{}
	for e := range strings.SplitSeq(s, ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			owners[e] = true
		}
	}
	return owners
}
