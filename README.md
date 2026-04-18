# cf-docker-registry-proxy

A Cloudflare Worker that proxies Docker Registry traffic and can exchange Docker Hub tokens using your own Docker Hub account credentials.

## Why

This project is useful when:

- you want a single custom registry hostname such as `docker.example.com`
- Docker Hub is reachable but anonymous pull limits are painful
- you want to keep client setup simple and avoid `docker login` on every machine

## Features

- Docker Registry v2 proxy for Docker Hub
- Docker Hub token exchange using Worker secrets
- Redirect-safe blob downloads for object storage URLs
- Optional routing to alternate registries such as `ghcr.io`, `quay.io`, and `registry.k8s.io`
- Basic browser landing page for the root path

## Secrets

Set these Worker secrets if you want authenticated Docker Hub token exchange:

- `DOCKERHUB_USER`
- `DOCKERHUB_PAT`

Example with Wrangler:

```bash
wrangler secret put DOCKERHUB_USER
wrangler secret put DOCKERHUB_PAT
```

## Optional environment variables

- `UA_BLOCKLIST`: comma or whitespace separated user-agent substrings to block
- `LANDING_PAGE_MODE`: `search`, `nginx`, or `redirect`
- `LANDING_PAGE_URL`: target URL when `LANDING_PAGE_MODE=redirect`

## Example client usage

```bash
docker pull docker.example.com/library/busybox:latest
docker pull ghcr.docker.example.com/owner/image:latest
docker pull quay.docker.example.com/org/image:latest
```

## How it works

1. `/v2/...` requests are proxied to the selected upstream registry.
2. `/token` requests are sent to `auth.docker.io`.
3. When Docker Hub credentials are configured, the Worker attaches `Authorization: Basic ...` while requesting the token.
4. Blob redirects are fetched without leaking registry `Authorization` or `Host` headers to signed object storage URLs.

## Development

```bash
npm test
```

## Limitations

- Docker Hub account limits still apply; this is not an unlimited mirror.
- If you expose the proxy publicly, other users can consume your Docker Hub quota.
- You should add your own access controls for production use.
