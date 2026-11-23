# deck's server in spaces mode only: private spaces behind alethi.dev's
# gate, read from a bucket. No talks are built into the image: alethi
# publish uploads a space to the bucket, so publishing redeploys nothing.
# Build with this folder as the context:
#
#   docker build -t deck-spaces server
#
# deploy/README.md lists the variables to set (DECK_GATE_SECRET,
# DECK_OWNERS and the bucket's AWS_* variables).

# Keep this tag at or above the go line in go.mod.
FROM golang:1.26.6-bookworm AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /app/server
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
# -spaces: refuse to start without DECK_GATE_SECRET rather than fall back
# to serving a talks site.
ENTRYPOINT ["/app/server", "-spaces"]
