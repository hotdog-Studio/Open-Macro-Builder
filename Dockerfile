# syntax=docker/dockerfile:1
# The web configurator as a small static site, for linux/amd64 and linux/arm64.
#
#   docker buildx build --platform linux/amd64,linux/arm64 -t open-macro-builder .
#   docker run --rm -p 8080:8080 open-macro-builder        then open http://localhost:8080
#
# The image holds only the built page and a web server. The macropad itself (AutoHotkey or
# PowerShell) runs on Windows and is not in it. See docs/docker.md.

# The page is the same on every architecture, so it is built once, on the machine doing the build.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /repo
# The build never starts Electron or a test browser.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY configurator/package.json configurator/package-lock.json configurator/
RUN cd configurator && npm ci
# The configurator shares its config checks with the repository's validator.
COPY scripts/validate-config-core.mjs scripts/validate-config-core.d.mts scripts/
COPY configurator configurator
RUN cd configurator && npm run build

FROM caddy:2-alpine
# Ties the image to its repository on ghcr.io. The build adds the version and the commit.
LABEL org.opencontainers.image.source="https://github.com/hotdog-Studio/Open-Macro-Builder" \
      org.opencontainers.image.title="Open Macro Builder configurator" \
      org.opencontainers.image.licenses="GPL-3.0-only"
# Caddy keeps its state under these; point them somewhere any user can write.
ENV SITE_ROOT=/srv XDG_DATA_HOME=/tmp XDG_CONFIG_HOME=/tmp
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/configurator/dist /srv
# Not root: the server only reads /srv and listens on a high port.
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
