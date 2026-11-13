# Development

How to set the project up, where things are, and how to run every test. For how the configurator's code is organised, see [architecture.md](architecture.md).

## What you need

| For | Install |
| --- | --- |
| The configurator, the validator and the script tests | [Node.js](https://nodejs.org/) 24 |
| The AutoHotkey version | [AutoHotkey v2](https://www.autohotkey.com/download/) on Windows |
| The PowerShell version and its tests | Windows PowerShell 5.1 (in Windows) and [Pester](https://pester.dev/) 5.5 or newer |
| The browser tests | Chromium for Playwright: `npx playwright install chromium` in `configurator/` |
| The Docker images | Docker with buildx |

The macropad itself only runs on Windows. The configurator, the validator and all of their tests also run on Linux and macOS, except the desktop-app tests, which need the Electron binary and a display.

## Repository layout

- `config.json`: the example layout.
- `ahk/`: the AutoHotkey version (`main.ahk`, `lib/`, `commands/`, `tests/`).
- `powershell/`: the PowerShell version, its tests and its docs.
- `img/`: icon sets, one folder per icon; `icon.svg` and `logo.svg`, and the `icon.ico` and `logo.png` made from them.
- `qmk/`: the VIA/QMK layout of the EPOMAKER EK21 keypad this was built for.
- `scripts/`: the config validator, the private-details check and their tests.
- `configurator/`: the web and desktop configurator (React, Vite, TypeScript, Electron).
- `Dockerfile`, `docker/`: the configurator's Docker images. See [docker.md](docker.md).
- `docs/`: these documents and their pictures.
- `Jenkinsfile`, `sonar-project.properties`, `ci/`: CI and the Jenkins job definition.
- `local/`: yours, ignored by git.

## Running the configurator

```
cd configurator
npm install
npm run dev          # the browser version; open the address it prints in Chrome or Edge
npm run electron     # the desktop app, built and started
npm run dist         # the Windows installer and portable exe, into configurator/release/
```

Press **Open folder** and pick this repository.

## Tests

| Command | From | What it runs |
| --- | --- | --- |
| `node --test "scripts/*.test.mjs"` | the repository root | The validator and the private-details check. |
| `node scripts/validate-config.mjs` | the repository root | Checks the layout both versions would load. |
| `npm test` | `configurator/` | The unit tests (Vitest, in Node and jsdom). Add `-- --coverage` for coverage. |
| `npm run test:browser` | `configurator/` | The app in headless Chromium: real mouse drags, keyboard, touch, small windows, a real folder handle, and pictures of the pad. |
| `npm run test:electron` | `configurator/` | Builds and launches the desktop app, drags a key, saves and checks the file on disk. Skips itself without the Electron binary or a display. |
| `npm run lint` and `npm run build` | `configurator/` | ESLint, then the type check and the production build. |
| `powershell -NoProfile -File powershell\tests\run.ps1` | the repository root, on Windows | The Pester suite of the PowerShell version. |

Tests never read anything under `local/`.

### Where a configurator test goes

| File name | Runs in | Use it for |
| --- | --- | --- |
| `*.test.ts`, `*.test.tsx` | Node or jsdom (`vite.config.ts`) | Logic, state, and anything that does not depend on layout. Fast, and counted in coverage. |
| `*.browser.test.tsx` | headless Chromium (`vitest.browser.config.ts`) | Anything that needs real sizes and real input: dragging, focus, scrolling, the code editor. Helpers are in `test/browser/harness.tsx`. |
| `e2e/*.e2e.test.ts` | the real desktop app (`vitest.electron.config.ts`) | What only the Electron shell does: the bridge, the sandbox, remembering the folder. |

jsdom does not lay anything out, so every element measures 0 by 0 there and a drag cannot be tested. That is what the browser tests are for.

### The pictures of the pad

`src/ui/visual.browser.test.tsx` compares screenshots of the grid with the references in `src/ui/__screenshots__/`. Text is drawn with the fonts of the machine, so the references are Windows ones and the suite skips itself on other systems. After a deliberate change to how the grid looks, remake them and check the new pictures before committing:

```
npx vitest run --config vitest.browser.config.ts src/ui/visual.browser.test.tsx --update
```

## Icons and logo

`img/icon.svg` is the hotdog; `img/logo.svg` is the hotdog on a key. `img/icon.ico` (the tray icon of both macropad versions, and the icon of the desktop app and its installer) and `img/logo.png` are made from them. After editing an SVG:

```
cd configurator && node scripts/make-icon.mjs
```

## Keeping private details out of git

`local/denylist.txt` lists strings that must never be committed, one per line. `scripts/check-private.mjs` fails when one would reach git. Run it from git hooks so nothing slips through:

```
printf '#!/bin/sh\nexec node scripts/check-private.mjs --staged\n' > .git/hooks/pre-commit
printf '#!/bin/sh\nexec node scripts/check-private.mjs --pre-push\n' > .git/hooks/pre-push
node scripts/check-private.mjs --history          # check every commit
```

## CI

Jenkins runs the `Jenkinsfile`:

1. Validates `config.json` and runs the script tests.
2. Installs, lints and unit-tests the configurator on the Linux agent, without the Electron binary.
3. Runs the browser tests in headless Chromium. The agent needs Chromium's system libraries (`npx playwright install-deps chromium`, once, as root); set the `OMB_SKIP_BROWSER_TESTS` global to skip the stage on an agent without them.
4. Builds the configurator.
5. On `develop` only: runs the Pester suite on the Windows agent (`windows-x64`).
6. Sends everything to SonarQube, with the coverage of the unit and the browser tests, and waits for the quality gate.
7. On `develop` only: packages the desktop app on the Windows agent (`windows-x64`), and builds the Linux images for both architectures, starting each one to check that it serves the page. The arm64 image is started on the arm64 agent (`linux-arm64`).
8. On `develop` only: publishes all of it as a release. [releasing.md](releasing.md) has the version scheme and the order of the steps.

The `Jenkinsfile` header lists the globals, such as `OMB_NTFY_URL` for build notifications.

The Jenkins job is a multibranch pipeline defined in `ci/jenkins-job.xml`. It checks out over SSH and scans for new commits every 2 minutes. To create it, or update it after editing the XML, put `JENKINS_URL` and `JENKINS_CREDENTIALS_ID` in `local/ci/jenkins.env` and run:

```
JENKINS_USER=<user> JENKINS_TOKEN=<api token> sh ci/create-jenkins-job.sh
```

The first analysis creates the SonarQube project `hotdog-Studio_open-macro-builder` if the Jenkins token may create projects. Otherwise, create it in SonarQube first.
