# The talks as a site with the live follow-along, for any host that runs
# a container. Copy this file and dockerignore (as .dockerignore) into
# your talks folder, next to package.json. See README.md here.

# ---- Decks ----------------------------------------------------------------
# publish needs deck from node_modules but no browser.
FROM oven/bun:1.3.6-alpine AS site
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN bun deck publish --out /site

# ---- Server ---------------------------------------------------------------
# Keep this tag at or above the go line in deck's server/go.mod.
FROM golang:1.26.6-bookworm AS server
WORKDIR /src
COPY --from=site /src/node_modules/@grindlemire/deck/server ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server .

# ---- Runtime --------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /out/server /app/server
COPY --from=site /site /app/site
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
# Set DECK_LEAD_KEY on the host: it is the key that leads a talk.
# Behind a proxy that puts the visitor's address in a header, add
# "-ip-header", "<that header>" (README.md lists the common ones).
ENTRYPOINT ["/app/server", "-site", "/app/site"]
