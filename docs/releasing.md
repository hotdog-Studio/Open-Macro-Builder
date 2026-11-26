# Releasing

What a release of Open Macro Builder is made of, how its number is chosen, and what Jenkins does to publish one. Nobody cuts a release by hand: **every green build of `develop` is a release.**

## What a release contains

| Artifact | Where it goes | Built on |
| --- | --- | --- |
| `Open-Macro-Builder-Setup-<version>.exe` (installer) and `Open-Macro-Builder-<version>-portable.exe` | The GitHub release of `v<version>` | The Windows agent, with `npm run dist` |
| `SHA256SUMS.txt`, the checksums of the two | The GitHub release | The controller |
| The configurator image for `linux/amd64` and `linux/arm64` | `ghcr.io/hotdog-studio/open-macro-builder` | The controller, from `Dockerfile` |
| The same image for `linux/amd64`, only when `OMB_REGISTRY` is set | A private registry you run, as `<version>` and `latest` | The controller |
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
- **Moving `MAJOR` or `MINOR`.** In `configurator/`, run `npm version <MAJOR>.<MINOR>.0 --no-git-tag-version`, set `sonar.projectVersion` in `sonar-project.properties` to `<MAJOR>.<MINOR>`, and commit. The next green build of `develop` is `<MAJOR>.<MINOR>.0`.

The `PATCH` in `package.json` stays `0`. The installer and the desktop app get the real number because the build writes it into its own copy of `package.json` before packaging.

## The changelog

`CHANGELOG.md` has a heading for each release, `## <version> - <date>`, newest first, under an empty **Unreleased**. The version is `MAJOR.MINOR.PATCH`, and every green build of `develop` is a release, so a patch release can add a feature or remove a command: its entry says so, in the group (Added, Changed, Removed, Fixed, Security) that fits.

- **Entries are written under Unreleased**, in the commit of the change a user would notice.
- **Before the merge into `develop` that releases them**, they move under `## <version> - <date>`, where `<version>` is what `node scripts/ci-version.mjs` prints on the branch and `<date>` is the day of the merge (`YYYY-MM-DD`). Unreleased stays at the top, empty.
- **A `develop` build checks it.** In the `Version` stage, `node scripts/ci-release.mjs changelog` fails the build when `CHANGELOG.md` has no heading `## <version> - <date>` for the version of this build, or has entries left under **Unreleased**. The build then ends FAILURE before anything else runs and takes no number. Other branches skip the check.

## What Jenkins does

Every branch is linted, tested and sent to SonarQube (see [development.md](development.md#ci)). Every branch also uses the Windows agents: the Pester suite runs on the Windows agent (`windows-x64`), and its Integration tests, the end-to-end test and the configurator's tests (unit, browser and desktop app) on the Windows agent with a logged-in desktop (`windows-desktop`); all of them must pass for a release. A build of `develop` that passes them and the quality gate then goes on, and is the only one to package the desktop app and to use the arm64 agent:

1. **Desktop app.** The Windows agent runs `npm ci` and `npm run dist` and hands back the two `.exe` files.
2. **Container images.** The controller builds the image for both architectures. The page is built once and copied onto each architecture's web server, so the arm64 image needs no emulation. `docker/smoke.sh` then starts each image and asks it for the page: the amd64 one on the controller, the arm64 one on the arm64 agent. The image build is given the version (`--build-arg APP_VERSION`), and the page carries it as the version of its copy of the scripts; a build without it is `<MAJOR>.<MINOR>.0-dev`.
3. **Release**, only when everything before it is green. In this order:
   1. the git tag `v<version>`, listing the commits since the tag before it;
   2. the images: `:<version>-amd64` and `:<version>-arm64`, then `:<version>`, `:<MAJOR>.<MINOR>` and `:latest`, each naming both architectures;
   3. the GitHub release, with the two `.exe` files and `SHA256SUMS.txt`.

The tag goes first so that a number is taken only once its tag exists. If a later step fails, run the build again: it finds the tag on the commit and carries on, replacing whatever was already published under that number.

### When a build releases nothing

A `develop` build ends FAILURE when a test fails, on Linux or on a Windows agent, when the configurator cannot be installed for its tests on Windows, or when the clean-up around the end-to-end test, or the one after the configurator's tests on Windows, could not do everything; it then takes no number. It ends UNSTABLE, with the reason in its log, and takes no number when:

- the Windows agent did not take the work within 45 minutes, for the Pester suite or for the desktop app (it is a virtual machine that is meant to be always on, but it runs one build at a time, so a build of another job can hold it, and it can be offline, while it restarts for example);
- the Windows agent with a desktop did not take the Integration tests or the end-to-end test within 45 minutes, or the configurator's tests within 60 (the time counts the work too);
- the arm64 agent did not take the work within 20 minutes;
- Jenkins has no GitHub credential (below), or the pipeline cannot see the checkout credential that pushes the tag.

Build it again once the cause is gone.

### What Jenkins needs

- Agents labelled `windows-x64` (Node, Git, AutoHotkey v2, and Pester 6.2.0 or newer installed for all users), `windows-desktop` (what `windows-x64` needs, plus a real, logged-in desktop that the build takes over for a few minutes, Python on `PATH`, and a way out to the npm registry, the Electron download and Playwright's Chromium download: the configurator stage downloads both there, after `npm ci`, through the agent user's own caches) and `linux-arm64` (Docker). One machine may carry both Windows labels. The `Jenkinsfile` header has the globals that rename them.
- The job's SSH checkout credential must be allowed to push tags.
- A **Username with password** credential with the id `omb-github`: a GitHub user name, and as the password a token of that user that may write this repository's contents (for the release) and write packages (for ghcr.io). A classic token with the `repo` and `write:packages` scopes does both.
- Optional: the global `OMB_REGISTRY`, the `host:port` of a private registry that takes a push without a login. Each release then also pushes the `linux/amd64` image there, as `<version>` and then `latest`, after the GitHub release. If that push fails the build ends unstable and the release stands. `OMB_REGISTRY_REPO` renames the repository (default `hotdogstudio/open-macro-builder`).

## The scripts in folders the configurator set up

A release needs nothing new for the configurator to offer its scripts to older folders. The app's copy of the scripts carries the release's version, because every build that ends in a release is given `APP_VERSION` (the image build as the build argument above), and every folder a release sets up or updates gets an `omb-manifest.json` that says what was written there ([architecture.md](architecture.md#the-manifest-and-the-known-releases)).

Only folders from before the manifest, set up by 1.0.2 to 1.0.5, are recognised by their files, from `configurator/src/core/update/knownReleases.json`. `node configurator/scripts/starter-history.mjs` makes that table from the release tags (run `git fetch --tags origin` first), and `starter-history.test.mjs` checks it against the tags this clone has. It is not run for a release that writes the manifest, since such a release's folders say what they hold. It is run again only if a release without the manifest was cut after the one the table names as `last` (1.0.5), so that the table covers that release too.

## Trying it by hand

The commands Jenkins runs also work on your own machine.

The desktop app, on Windows:

```
cd configurator
npm ci
npm run dist
```

The two `.exe` files appear in `configurator/release/`.

Built that way, the app is a development build: the `.exe` files carry the version in `configurator/package.json`, and the page is `<MAJOR>.<MINOR>.0-dev`, which offers its scripts to no folder a later release of its line set up or updated. Jenkins gives the app its version first, and in PowerShell you can do the same before `npm run dist`: `$env:APP_VERSION = node ..\scripts\ci-version.mjs` (the build reads it) and `npm version $env:APP_VERSION --no-git-tag-version --allow-same-version` (the `.exe` files' number; it rewrites `package.json` and `package-lock.json`, which Jenkins does only in a throwaway checkout, so undo it afterwards).

One image, and the check that it serves the page:

```
docker buildx build --platform linux/amd64 --build-arg "APP_VERSION=$(node scripts/ci-version.mjs)" -t open-macro-builder --load .
sh docker/smoke.sh open-macro-builder x86_64
```

The build argument is the version Jenkins gives the image: without it the page is `<MAJOR>.<MINOR>.0-dev`, which counts as older than every later release of its line, so it never offers its scripts to a folder such a release set up or updated. The command needs Node and a clone with its tags (`git fetch --tags origin`): without the tags it gives `<MAJOR>.<MINOR>.0`, and without Node or the clone's `.git` it gives nothing, so the page is `<MAJOR>.<MINOR>.0-dev` again.

## After the first release

1. On GitHub, open the package `open-macro-builder` under the organisation's **Packages**, set its visibility to public and link it to the repository. A package starts private, and this is done once.
2. Install the installer on a clean Windows account, open a folder, change something, save, and reload the macropad.
3. `docker run --rm -p 8080:8080 ghcr.io/hotdog-studio/open-macro-builder` and open <http://localhost:8080>.
