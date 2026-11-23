# Hosting the talks

You don't need any of this to give a talk: `bun deck serve` runs the
follow-along from your laptop. Host the talks when you want a public link,
or a follow-along that works on any network, including venue Wi-Fi that
won't let phones reach your laptop.

There are two ways:

- **A static site,** on GitHub Pages or any static host. You get the
  decks, their link previews and a list of your talks. There's no
  follow-along, and the speaker notes stay off the site.
- **A container** that runs deck's server. You get everything, including
  the follow-along on any network and your notes in the presenter window
  of the hosted deck.

## A static site: GitHub Pages

`bun deck publish --static` writes the site for a host that only serves
files:

- the speaker notes are left out entirely, since a static host would hand
  them to anyone;
- the decks show no Go live button and never ask for a key;
- the links are relative, so the site works at any path, such as
  `you.github.io/my-talks/`.

To publish on every push:

1. Copy the workflow into your talks repo:

   ```
   mkdir -p .github/workflows
   cp node_modules/@grindlemire/deck/deploy/github-pages.yml .github/workflows/pages.yml
   ```

2. In the repo's **Settings > Pages**, set **Source** to **GitHub Actions**.

3. Run `bun deck check` on each talk and commit what it writes in
   `deck/share/`: the link preview image and the tab icons. The workflow
   has no browser to render them.

Push, and the talks are at `https://you.github.io/<repo>/talks/`. For
another static host, run `bun deck publish --static` and upload `site/`.

## A container: everything, including the follow-along

`bun deck publish` writes every talk as a static site in `site/`, and
`server/` (Go, standard library only) serves that site and adds the
follow-along. The Dockerfile here does both in one image. Any host that
runs a container works: Railway, Fly, Render, a VPS with Docker.

1. Copy `Dockerfile` into your talks folder, and `dockerignore` as
   `.dockerignore`. In the talks folder:

   ```
   cp node_modules/@grindlemire/deck/deploy/Dockerfile .
   cp node_modules/@grindlemire/deck/deploy/dockerignore .dockerignore
   ```

2. Say where the talks will live, in `deck.config.json`:

   ```json
   { "site": "https://example.com" }
   ```

   Link previews and the follow-along QR codes use it. The talks go under
   `/talks` (`"prefix": ""` puts them at the site's root).

3. Run `bun deck check` on each talk and commit what it writes in
   `deck/share/` and `deck/media/qr-follow.svg`. The image has no browser to
   render them.

4. Deploy the image, with these settings on the host:

   - `DECK_LEAD_KEY`: the key that leads a talk. Without it the server
     makes one up at every start.
   - `PORT`, if the host picks the port (default 8080).
   - One instance only. Live state is in memory.

### Behind a proxy

The server rate-limits reactions by the visitor's address. Behind a proxy
every visitor arrives from the proxy's address, so tell the server which
header holds the real one: add `"-ip-header", "X-Real-IP"` to the
Dockerfile's `ENTRYPOINT`. The header is `X-Real-IP` on Railway,
`Fly-Client-IP` on Fly and `CF-Connecting-IP` behind Cloudflare. Only do
this when every request comes through that proxy: anyone who reaches the
server directly can put any address in the header.

### Example: Railway

A `railway.toml` next to the Dockerfile:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/talks"
restartPolicyType = "ON_FAILURE"
```

Set `DECK_LEAD_KEY` on the service, add `-ip-header X-Real-IP` as
above, and point your domain at it.

## Private spaces, behind alethi.dev's gate

The server has a second mode for private work: each "space" (an
engagement) is a static site, such as a report, plus decks with the
follow-along, served behind alethi.dev's sign-in gate. The content lives
in an S3-compatible bucket that `alethi publish <space> <dir>` fills, so
publishing never redeploys anything: the server picks up a new publish
within about 10 seconds.

`server/Dockerfile` builds an image with only the server, in this mode.
Build it with `server/` as the context (on Railway, set the service's
root directory to `server`).

### Settings

| Variable | |
|---|---|
| `DECK_GATE_SECRET` | turns the mode on: the secret the gate signs requests with (its `GATE_IDENTITY_SECRET`), at least 32 bytes |
| `DECK_OWNERS` | emails, comma-separated, that may lead the decks and read their notes |
| `DECK_IP_HEADER` | the header holding the visitor's address (`X-Real-IP` on Railway), for signed-out followers' rate limits |
| `AWS_ENDPOINT_URL` | the bucket's endpoint, an origin like `https://storage.example.com` |
| `AWS_S3_BUCKET_NAME` | the bucket |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | its credentials |
| `AWS_DEFAULT_REGION` | its region (default `auto`) |
| `AWS_S3_URL_STYLE` | `path` (default) or `virtual-hosted` |
| `PORT` | the port to listen on (default 8080) |

The `AWS_*` names are the ones Railway sets on a service you connect a
bucket to, and the ones `railway bucket credentials` prints. Run one
instance: live state is in memory. Only the gate should be able to reach
the service (no public domain of its own): requests without the gate's
signature get 403, so there is no health check path.

### How a space is served

Every request must carry the gate's signed `X-Gate-*` headers. The space
comes only from `X-Gate-Space`, never from the path, and its files from
`spaces/<space>/` in the bucket, through `spaces/<space>/_manifest.json`.
Decks are `talks/<talk>/index.html`, each with a live room at the same
routes as the talks site; their notes are `talks/<talk>/notes.json`,
which is never served as a file. The owners lead and get the notes with
no key; anyone else gets 403 on those. Pages the server writes (the
follow page, redirects) use the gate's public path, `X-Gate-Prefix`.

The gate can also let people who are not signed in follow a talk (its
`Public` paths); it signs their requests with an empty `X-Gate-Email`.
They may only open `talks/<talk>/live`, its `events`, its `slides` and
post a `react`; anything else is 403. While the talk is not live, `live`
is a page with no deck in it and the rest is refused. While it is live,
`live` is the deck with every slide left out, and `slides?upto=<n>`
returns the slides from the first to the furthest the speaker has shown
since going live (forgotten when they stop). When the talk stops, their
event stream says it ended and closes. Their reactions are limited per
address: set `DECK_IP_HEADER` to the header the edge puts it in
(`X-Real-IP` on Railway).

Build a space's decks with the gate's path in the prefix and
`"auth": "gate"`, so they lead without a key:

```json
{ "prefix": "/p/qmdjrq74/talks", "auth": "gate" }
```

`bun deck publish` then writes the space under `site/p/qmdjrq74/`; that
folder is what `alethi publish` uploads.

### Running it locally

`-spaces-dir <dir>` reads a directory laid out like the bucket instead.
`-write-manifest` writes the manifest that `alethi publish` would. In the
talks folder:

```
go -C node_modules/@grindlemire/deck/server build -o "$PWD/deck-server" .
mkdir -p spaces-local/spaces/test
cp -R site/p/qmdjrq74/ spaces-local/spaces/test/
./deck-server -write-manifest spaces-local/spaces/test
DECK_GATE_SECRET=<32+ bytes> DECK_OWNERS=you@example.com \
  ./deck-server -spaces-dir spaces-local -addr :8090
```

Put alethi.dev's gate in front (with the same secret as its
`GATE_IDENTITY_SECRET`), or sign a request by hand:

```
secret=<the same>; space=test; prefix=/p/qmdjrq74; email=you@example.com
at=/talks; ts=$(date +%s)
sig=$(printf 'v1\n%s\n%s\n%s\n%s\nGET\n%s' "$space" "$prefix" "$email" "$ts" "$at" |
  openssl dgst -sha256 -hmac "$secret" -binary | base64 | tr '+/' '-_' | tr -d '=')
curl -H "X-Gate-Space: $space" -H "X-Gate-Prefix: $prefix" -H "X-Gate-Email: $email" \
  -H "X-Gate-Time: $ts" -H "X-Gate-Signature: $sig" "http://localhost:8090$at"
```
