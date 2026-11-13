# Changelog

What changed in each version, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Configurator: everything that can be dragged can be done from the keyboard. Alt + arrow moves a key on the Pad shape tab and swaps a layer or macro with the key beside it on the other tabs; Shift + Alt + arrow resizes a key; Enter on a command or a parked layer puts it on the selected key.
- Configurator, in the browser: a Download link to the desktop app on the GitHub releases page, in the header and on the start screen.
- Docker images of the web configurator for `linux/amd64` and `linux/arm64`, published at `ghcr.io/hotdog-studio/open-macro-builder`, and a Dockerfile for a Windows container.
- Releases: every green build of `develop` is published as a GitHub release with the Windows installer and a portable exe, and as a container image.
- The hotdog icon redrawn as clean pixel art from an SVG source, and a logo. Both macropad versions and the desktop app use the new icon.
- Developer documentation: `CONTRIBUTING.md` and `docs/`.

### Fixed

- Configurator: a command or parked layer dropped on the Fn key no longer lands on the key beside it.
- Configurator: a key can be picked up again straight after it is dropped.
- Configurator: in a window narrower than the pad, the left columns of the pad can be scrolled to.
- Configurator: with the pad scrolled, a layer dragged to the Parked shelf is parked, not dropped on a key hidden behind the side panel.
- Configurator: the header and the Commands toolbar wrap in a narrow window, so the page no longer scrolls sideways.
- Configurator: a key's resize corner works on a touch screen.
