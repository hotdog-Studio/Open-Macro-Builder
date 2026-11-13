# Releasing

What a release of Open Macro Builder is made of, and the steps to cut one.

## What a release contains

| Artifact | Where it goes | Built by |
| --- | --- | --- |
| `Open Macro Builder Setup <version>.exe` (installer) and `Open Macro Builder <version> portable.exe` | The GitHub release | `npm run dist` in `configurator/`, on Windows |
| The configurator image for `linux/amd64` and `linux/arm64` | `ghcr.io/hotdog-studio/open-macro-builder` | `Dockerfile` |
| The configurator image for `windows/amd64` | `ghcr.io/hotdog-studio/open-macro-builder` | `docker/Dockerfile.windows`, on a Windows host |
| The source, which is the macropad itself | The GitHub release's source archive | git |

The version is the `version` in `configurator/package.json`. The installer and the portable exe take their names from it, and the git tag is `v<version>`.

## Before the release

1. Everything is merged, and CI is green on the commit to release, including the browser tests and the Windows tests.
2. On a Windows machine, in `configurator/`: `npm run test:electron` passes. CI cannot run it.
3. Set the version: `npm version <version> --no-git-tag-version` in `configurator/` (it updates `package.json` and `package-lock.json`).
4. Move the entries under **Unreleased** in `CHANGELOG.md` to a heading for the version, with the date.
5. Run `node scripts/check-private.mjs --history`: nothing personal is in any commit.
6. Commit, and tag the commit `v<version>`.

## Building the artifacts

The build and publish pipeline is not in this repository yet. Until it is, these are the commands it has to run, and they work by hand.

The desktop app, on Windows:

```
cd configurator
npm ci
npm run dist
```

The two `.exe` files appear in `configurator/release/`. They are unsigned.

The Linux images:

```
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/hotdog-studio/open-macro-builder:<version> --push .
```

The Windows image, on a Windows host in Windows-container mode:

```
cd configurator; npm ci; npm run build; cd ..
docker build -f docker/Dockerfile.windows -t ghcr.io/hotdog-studio/open-macro-builder:<version>-windows .
docker push ghcr.io/hotdog-studio/open-macro-builder:<version>-windows
```

To offer the Windows image under the same tag as the Linux ones, join them into one multi-platform tag after pushing each on its own:

```
docker buildx imagetools create -t ghcr.io/hotdog-studio/open-macro-builder:<version> \
  ghcr.io/hotdog-studio/open-macro-builder:<version>-linux \
  ghcr.io/hotdog-studio/open-macro-builder:<version>-windows
```

(Push the Linux images as `<version>-linux` in that case.)

## After the release

1. Install the installer on a clean Windows account, open a folder, change something, save, and reload the macropad.
2. `docker run --rm -p 8080:8080 ghcr.io/hotdog-studio/open-macro-builder:<version>` and open <http://localhost:8080>.
3. Check that the package on ghcr.io is public and linked to the repository.
