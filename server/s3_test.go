package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The GET Object example in AWS's SigV4 docs
// (https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html).
func TestSignV4MatchesTheAWSExample(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	req.Header.Set("Range", "bytes=0-9")
	at := time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC)
	signV4(req, "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1", "s3", emptySHA256, at)
	want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
		"SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
		"Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if got := req.Header.Get("Authorization"); got != want {
		t.Errorf("Authorization =\n  %s\nwant\n  %s", got, want)
	}
	if req.Header.Get("X-Amz-Date") != "20130524T000000Z" {
		t.Errorf("x-amz-date = %q", req.Header.Get("X-Amz-Date"))
	}
}

func TestS3EscapePath(t *testing.T) {
	for in, want := range map[string]string{
		"/b/spaces/x/index.html":     "/b/spaces/x/index.html",
		"/b/a b/c+d~e_f-g.h":         "/b/a%20b/c%2Bd~e_f-g.h",
		"/b/café/%":                  "/b/caf%C3%A9/%25",
		"/b/spaces/x/_manifest.json": "/b/spaces/x/_manifest.json",
	} {
		if got := s3EscapePath(in); got != want {
			t.Errorf("s3EscapePath(%q) = %q; want %q", in, got, want)
		}
	}
}

func TestS3GetPathStyleAndConditional(t *testing.T) {
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.URL.EscapedPath())
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AK/") {
			http.Error(w, "unsigned", http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case "/bk/spaces/s/a b.txt":
			if r.Header.Get("If-None-Match") == `"v1"` {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("ETag", `"v1"`)
			_, _ = w.Write([]byte("hello"))
		default:
			http.Error(w, "<Error><Code>NoSuchKey</Code></Error>", http.StatusNotFound)
		}
	}))
	defer srv.Close()
	c, err := newS3Client(srv.URL, "bk", "auto", "AK", "SK", false)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	body, etag, err := c.get(ctx, "spaces/s/a b.txt", "")
	if err != nil || string(body) != "hello" || etag != `"v1"` {
		t.Fatalf("get = %q %q %v", body, etag, err)
	}
	if _, _, err := c.get(ctx, "spaces/s/a b.txt", `"v1"`); !errors.Is(err, errNotModified) {
		t.Errorf("conditional get = %v; want errNotModified", err)
	}
	if _, _, err := c.get(ctx, "spaces/s/nope", ""); !errors.Is(err, errNotFound) {
		t.Errorf("missing get = %v; want errNotFound", err)
	}
	if seen[0] != "/bk/spaces/s/a%20b.txt" {
		t.Errorf("requested %q; want path-style /bk/spaces/s/a%%20b.txt", seen[0])
	}
}

func TestS3FromEnv(t *testing.T) {
	for _, k := range []string{envEndpoint, envBucket, envRegion, envAccessKey, envSecretKey, envURLStyle} {
		t.Setenv(k, "")
	}
	if c, err := s3FromEnv(); c != nil || err != nil {
		t.Errorf("no bucket env: %v %v; want none", c, err)
	}
	t.Setenv(envEndpoint, "https://storage.example.com")
	t.Setenv(envBucket, "spaces-abc")
	if _, err := s3FromEnv(); err == nil || !strings.Contains(err.Error(), envAccessKey) {
		t.Errorf("missing keys: err = %v", err)
	}
	t.Setenv(envAccessKey, "AK")
	t.Setenv(envSecretKey, "SK")
	t.Setenv(envURLStyle, "virtual-hosted")
	c, err := s3FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if got := c.objectURL("spaces/x/index.html"); got != "https://spaces-abc.storage.example.com/spaces/x/index.html" {
		t.Errorf("virtual-hosted URL = %s", got)
	}
	if c.region != "auto" {
		t.Errorf("region = %q; want auto when unset", c.region)
	}
}
