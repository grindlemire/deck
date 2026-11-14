# Hosting the talks

You don't need any of this to give a talk: `bun deck serve` runs the
follow-along from your laptop. Host the talks when you want a public link,
or a follow-along that works on any network, including venue Wi-Fi that
won't let phones reach your laptop.

## What runs

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

## Behind a proxy

The server rate-limits reactions by the visitor's address. Behind a proxy
every visitor arrives from the proxy's address, so tell the server which
header holds the real one: add `"-ip-header", "X-Real-IP"` to the
Dockerfile's `ENTRYPOINT`. The header is `X-Real-IP` on Railway,
`Fly-Client-IP` on Fly and `CF-Connecting-IP` behind Cloudflare. Only do
this when every request comes through that proxy: anyone who reaches the
server directly can put any address in the header.

## Example: Railway

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
