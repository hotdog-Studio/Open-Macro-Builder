# Releasing

What a release of Open Macro Builder is made of, how its number is chosen, and what Jenkins does to publish one. Nobody cuts a release by hand: **every green build of `develop` is a release.**

## What a release contains

| Artifact | Where it goes | Built on |
| --- | --- | --- |
| `Open-Macro-Builder-Setup-<version>.exe` (installer) and `Open-Macro-Builder-<version>-portable.exe` | The GitHub release of `v<version>` | The Windows agent, with `npm run dist` |
| `SHA256SUMS.txt`, the checksums of the two | The GitHub release | The controller |
| The configurator image for `linux/amd64` and `linux/arm64` | `ghcr.io/hotdog-studio/open-macro-builder` | The controller, from `Dockerfile` |
| The source, which is the macropad itself | The GitHub release's source archive | git |

The two `.exe` files are not signed, so Windows SmartScreen warns the first time one is run. Signing needs a code-signing certificate; with one, electron-builder signs during `npm run dist`.

## The version number

A version is `MAJOR.MINOR.PATCH`, and `node scripts/ci-version.mjs` prints the one the next build of the current commit gets.

| Part | Where it comes from |
| --- | --- |
| `MAJOR.MINOR` | The first two numbers of `version` in `configurator/package.json`. Only the maintainer changes them, in a commit. |
| `PATCH` | The newest `v<MAJOR>.<MINOR>.*` git tag reachable from the commit, plus one. The first build of a line is `.0`. |

- **Tags are the record.** Jenkins pushes the tag `v<version>` for each release and writes nothing back to the repository. Never push a `v*` tag by hand.
- **One number, one commit.** A build of a commit that already has the newest tag is a rebuild of that release and keeps its number. A red build takes no number.
- **Moving `MAJOR` or `MINOR`.** In `configurator/`, run `npm version <MAJOR>.<MINOR>.0 --no-git-tag-version`, set `sonar.projectVersion` in `sonar-project.properties` to `<MAJOR>.<MINOR>`, move the entries under **Unreleased** in `CHANGELOG.md` to a heading for the line that just ended, and commit. The next green build of `develop` is `<MAJOR>.<MINOR>.0`.

The `PATCH` in `package.json` stays `0`. The installer and the desktop app get the real number because the build writes it into its own copy of `package.json` before packaging.

## What Jenkins does

Every branch is linted, tested and sent to SonarQube (see [development.md](development.md#ci)). A build of `develop` that passes the quality gate then goes on, and is the only one to use the Windows and the arm64 agent:

1. **Desktop app.** The Windows agent runs `npm ci` and `npm run dist` and hands back the two `.exe` files.
2. **Container images.** The controller builds the image for both architectures. The page is built once and copied onto each architecture's web server, so the arm64 image needs no emulation. `docker/smoke.sh` then starts each image and asks it for the page: the amd64 one on the controller, the arm64 one on the arm64 agent.
3. **Release**, only when everything before it is green. In this order:
   1. the git tag `v<version>`, listing the commits since the tag before it;
   2. the images: `:<version>-amd64` and `:<version>-arm64`, then `:<version>`, `:<MAJOR>.<MINOR>` and `:latest`, each naming both architectures;
   3. the GitHub release, with the two `.exe` files and `SHA256SUMS.txt`.

The tag goes first so that a number is taken only once its tag exists. If a later step fails, run the build again: it finds the tag on the commit and carries on, replacing whatever was already published under that number.

### When a build releases nothing

A `develop` build ends UNSTABLE, with the reason in its log, and takes no number when:

- the Windows agent did not take the work within 45 minutes (it is a desktop PC, and may be off);
- the arm64 agent did not take the work within 20 minutes;
- Jenkins has no GitHub credential (below), or the pipeline cannot see the checkout credential that pushes the tag.

Build it again once the cause is gone.

### What Jenkins needs

- Agents labelled `windows-x64` (Node and Git) and `linux-arm64` (Docker). The `Jenkinsfile` header has the globals that rename them.
- The job's SSH checkout credential must be allowed to push tags.
- A **Username with password** credential with the id `omb-github`: a GitHub user name, and as the password a token of that user that may write this repository's contents (for the release) and write packages (for ghcr.io). A classic token with the `repo` and `write:packages` scopes does both.

## Trying it by hand

The commands Jenkins runs also work on your own machine.

The desktop app, on Windows:

```
cd configurator
npm ci
npm run dist
```

The two `.exe` files appear in `configurator/release/`.

One image, and the check that it serves the page:

```
docker buildx build --platform linux/amd64 -t open-macro-builder --load .
sh docker/smoke.sh open-macro-builder x86_64
```

## After the first release

1. On GitHub, open the package `open-macro-builder` under the organisation's **Packages**, set its visibility to public and link it to the repository. A package starts private, and this is done once.
2. Install the installer on a clean Windows account, open a folder, change something, save, and reload the macropad.
3. `docker run --rm -p 8080:8080 ghcr.io/hotdog-studio/open-macro-builder` and open <http://localhost:8080>.
