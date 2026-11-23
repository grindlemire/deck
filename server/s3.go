package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"
)

// s3Client reads objects from an S3-compatible bucket (a Railway bucket),
// signing each request with AWS Signature Version 4. It only GETs: the
// spaces mode reads what alethi publish uploaded and never writes.
type s3Client struct {
	endpoint    *url.URL // https://storage.example.com, no path
	bucket      string
	region      string
	accessKey   string
	secretKey   string
	virtualHost bool // bucket.host/key instead of host/bucket/key
	http        *http.Client
	now         func() time.Time
}

// The variables Railway sets on a service it connects a bucket to (and
// what `railway bucket credentials` prints).
const (
	envEndpoint  = "AWS_ENDPOINT_URL"
	envBucket    = "AWS_S3_BUCKET_NAME"
	envRegion    = "AWS_DEFAULT_REGION"
	envAccessKey = "AWS_ACCESS_KEY_ID"
	envSecretKey = "AWS_SECRET_ACCESS_KEY"
	envURLStyle  = "AWS_S3_URL_STYLE" // "path" (the default) or "virtual-hosted"
)

// s3FromEnv is the bucket the environment names, or nil when it names none.
func s3FromEnv() (*s3Client, error) {
	get := func(k string) string { return strings.TrimSpace(os.Getenv(k)) }
	if get(envEndpoint) == "" && get(envBucket) == "" {
		return nil, nil
	}
	var missing []string
	for _, k := range []string{envEndpoint, envBucket, envAccessKey, envSecretKey} {
		if get(k) == "" {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("bucket: %s not set", strings.Join(missing, ", "))
	}
	region := get(envRegion)
	if region == "" {
		region = "auto"
	}
	style := get(envURLStyle)
	if style != "" && style != "path" && style != "virtual-hosted" {
		return nil, fmt.Errorf("bucket: %s is %q; want path or virtual-hosted", envURLStyle, style)
	}
	return newS3Client(get(envEndpoint), get(envBucket), region, get(envAccessKey), get(envSecretKey), style == "virtual-hosted")
}

func newS3Client(endpoint, bucket, region, accessKey, secretKey string, virtualHost bool) (*s3Client, error) {
	u, err := url.Parse(strings.TrimRight(endpoint, "/"))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.Path != "" {
		return nil, fmt.Errorf("bucket: endpoint %q is not a URL like https://storage.example.com", endpoint)
	}
	return &s3Client{
		endpoint:    u,
		bucket:      bucket,
		region:      region,
		accessKey:   accessKey,
		secretKey:   secretKey,
		virtualHost: virtualHost,
		http:        &http.Client{Timeout: 30 * time.Second},
		now:         time.Now,
	}, nil
}

func (c *s3Client) String() string { return "bucket " + c.bucket + " at " + c.endpoint.Host }

var (
	errNotFound    = errors.New("not found")
	errNotModified = errors.New("not modified")
)

// maxObject caps what one GET reads into memory.
const maxObject = 64 << 20

// get reads the object at key. With etag set it is a conditional GET:
// errNotModified when the object still has that ETag. errNotFound when
// there is no such object.
func (c *s3Client) get(ctx context.Context, key, etag string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.objectURL(key), nil)
	if err != nil {
		return nil, "", err
	}
	signV4(req, c.accessKey, c.secretKey, c.region, "s3", emptySHA256, c.now())
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusNotModified:
		return nil, etag, errNotModified
	case http.StatusNotFound:
		return nil, "", errNotFound
	default:
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, "", fmt.Errorf("GET %s: %s: %s", key, res.Status, strings.TrimSpace(string(msg)))
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxObject+1))
	if err != nil {
		return nil, "", fmt.Errorf("GET %s: %w", key, err)
	}
	if len(body) > maxObject {
		return nil, "", fmt.Errorf("GET %s: over %d bytes", key, maxObject)
	}
	return body, res.Header.Get("ETag"), nil
}

// objectURL addresses key path-style (endpoint/bucket/key), or
// virtual-hosted (bucket.endpoint/key).
func (c *s3Client) objectURL(key string) string {
	u := *c.endpoint
	p := "/" + c.bucket + "/" + key
	if c.virtualHost {
		u.Host = c.bucket + "." + u.Host
		p = "/" + key
	}
	u.Path = p
	u.RawPath = s3EscapePath(p)
	return u.String()
}

const emptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// signV4 signs req for AWS Signature Version 4 in its Authorization
// header (https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html).
// It signs the host and every header req already has, plus the
// x-amz-date and x-amz-content-sha256 it sets. payloadHash is the hex
// SHA-256 of the body (emptySHA256 for a GET). The query is not signed:
// this client sends none.
func signV4(req *http.Request, accessKey, secretKey, region, service, payloadHash string, t time.Time) {
	t = t.UTC()
	amzDate := t.Format("20060102T150405Z")
	day := t.Format("20060102")
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)

	host := req.Host
	if host == "" {
		host = req.URL.Host
	}
	headers := map[string]string{"host": host}
	for k, vs := range req.Header {
		trimmed := make([]string, len(vs))
		for i, v := range vs {
			trimmed[i] = strings.Join(strings.Fields(v), " ")
		}
		headers[strings.ToLower(k)] = strings.Join(trimmed, ",")
	}
	names := make([]string, 0, len(headers))
	for k := range headers {
		names = append(names, k)
	}
	slices.Sort(names)
	var canonHeaders strings.Builder
	for _, k := range names {
		canonHeaders.WriteString(k + ":" + headers[k] + "\n")
	}
	signed := strings.Join(names, ";")

	canonical := strings.Join([]string{
		req.Method,
		s3EscapePath(req.URL.Path),
		"", // no query
		canonHeaders.String(),
		signed,
		payloadHash,
	}, "\n")
	scope := day + "/" + region + "/" + service + "/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hexSHA256([]byte(canonical))

	key := hmacSHA256([]byte("AWS4"+secretKey), day)
	key = hmacSHA256(key, region)
	key = hmacSHA256(key, service)
	key = hmacSHA256(key, "aws4_request")
	sig := hex.EncodeToString(hmacSHA256(key, toSign))

	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+accessKey+"/"+scope+
		", SignedHeaders="+signed+", Signature="+sig)
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

func hexSHA256(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// s3EscapePath percent-encodes a path the way SigV4 wants it for S3:
// every byte but the unreserved ones (A-Z a-z 0-9 - _ . ~) and the
// slashes, once.
func s3EscapePath(p string) string {
	var b strings.Builder
	for i := 0; i < len(p); i++ {
		c := p[i]
		if c == '/' || c == '-' || c == '_' || c == '.' || c == '~' ||
			('A' <= c && c <= 'Z') || ('a' <= c && c <= 'z') || ('0' <= c && c <= '9') {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
