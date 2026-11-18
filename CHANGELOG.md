# Changelog

What changed in each version, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Configurator: hovering a function in the Commands tab shows its docs (what it does, how to call it, an example, each parameter), and the right panel lists what else a command can call. The PowerShell functions meant for commands now carry help blocks, which `Get-Help` reads too.
- Configurator: an empty folder can be set up as a fresh copy. **Open folder** on an empty folder offers to copy in the scripts, the icons and the example layout, and **Create new folder…** on the start screen makes the folder first. The files are carried inside the app, so no download or clone is needed.
- Configurator: a **Get started** tab for people new to AutoHotkey and PowerShell. It says what to install, how to set up the keypad, and how to start, try and autostart the macropad, with the steps for the version ticked under **I run**. The start screen shows the same guide, and a folder that was just set up opens on it.
- Configurator: the web page shows the project logo as its browser tab icon.
- Releases: with the Jenkins global `OMB_REGISTRY` set, each release also pushes the `linux/amd64` image to that private registry ([docs/releasing.md](docs/releasing.md)).

### Changed

- Configurator: a folder without `local/config.json` is now offered only a copy in `local/`. The option to edit the shared example `config.json` itself is gone, so the example stays as everyone gets it.
- Configurator: the right-hand panel on Pad shape, Layers and Macros grows to fit the overlay preview, so the preview shows whole without a sideways scrollbar of its own. The panel stops at half the window, and a preview wider than that scrolls as before.
- Configurator: messages float over the editor and no longer push it down. Notices are blue and refused actions amber, and both leave by themselves after a few seconds. Failures are red and stay until dismissed, and so do the notices shown when a folder is opened.
- Configurator: the New command file dialog and the `local/config.json` prompt no longer mention git, because a folder the configurator sets up is a plain copy and not a clone. The comment at the top of a new `local/ahk/commands.ahk` changed with them.
- Desktop app: the two links in the Get started guide, to the AutoHotkey download page and to the contributing guide, open in the default browser. Every other address is still refused.
- Configurator: in a window narrower than 1440 px the header leaves out the path of the layout file, so the five tabs and the buttons stay on one row at the desktop app's default size.

### Security

- Build tools: `minimatch` is held at 11.0.8 or newer, which fixes a slow pattern match ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). Only linting and packaging used the affected versions; nothing in the app or the image did.

## 1.0.0 - 2026-11-14

The first release.

### Added

- Configurator: everything that can be dragged can be done from the keyboard. Alt + arrow moves a key on the Pad shape tab and swaps a layer or macro with the key beside it on the other tabs; Shift + Alt + arrow resizes a key; Enter on a command or a parked layer puts it on the selected key.
- Configurator, in the browser: a Download link to the desktop app on the GitHub releases page, in the header and on the start screen.
- Docker images of the web configurator for `linux/amd64` and `linux/arm64`, published at `ghcr.io/hotdog-studio/open-macro-builder`.
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
