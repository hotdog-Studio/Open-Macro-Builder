# Development

How to set the project up, where things are, and how to run every test. For how the configurator's code is organised, see [architecture.md](architecture.md).

## What you need

| For | Install |
| --- | --- |
| The configurator, the validator and the script tests | [Node.js](https://nodejs.org/) 24 |
| The AutoHotkey version | [AutoHotkey v2](https://www.autohotkey.com/download/) on Windows |
| The PowerShell version and its tests | Windows PowerShell 5.1 (in Windows) and [Pester](https://pester.dev/) 5.5 or newer |
| The end-to-end test | Windows PowerShell 5.1, Pester 5.5 or newer, [AutoHotkey v2](https://www.autohotkey.com/download/) and [Python](https://www.python.org/downloads/) on `PATH`, on a Windows desktop you can give up for a few minutes |
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

> [!WARNING]
> **Photosensitivity warning.** Some of these suites open, move and close windows in quick succession, which makes the screen flash and flicker. If you have photosensitive epilepsy, or flashing affects you, do not watch the screen while they run: look away, switch the monitor off, or let CI run them.
>
> The ones that do it: the Pester suite (`powershell\tests\run.ps1`), which shows a tooltip and small test windows even when its Integration tests are left out (it builds the overlay and the delayed key and click forms but never shows them), and more with them; the end-to-end test (`powershell\tests\run.ps1 -EndToEnd`), which opens, moves, maximizes and closes windows, shows Task View and the screen capture, and switches the virtual desktop, at most three changes a second; and the desktop-app tests (`npm run test:electron`), which open and close the app's window. The configurator's unit tests and browser tests run without a visible window.

| Command | From | What it runs |
| --- | --- | --- |
| `node --test "scripts/*.test.mjs"` | the repository root | The validator and the private-details check. |
| `node scripts/validate-config.mjs` | the repository root | Checks the layout both versions would load. |
| `npm test` | `configurator/` | The unit tests (Vitest, in Node and jsdom). Add `-- --coverage` for coverage. |
| `npm run test:browser` | `configurator/` | The app in headless Chromium: real mouse drags, keyboard, touch, small windows, a real folder handle, and pictures of the pad. |
| `npm run test:electron` | `configurator/` | Builds and launches the desktop app, drags a key, saves and checks the file on disk, and sets up a fresh copy in an empty folder. Skips itself without the Electron binary or a display. |
| `npm run lint` and `npm run build` | `configurator/` | ESLint, then the type check and the production build. |
| `powershell -NoProfile -File powershell\tests\run.ps1` | the repository root, on Windows | The Pester suite: the PowerShell version's tests (every key name its commands press exists, among them), the checks of the AutoHotkey version (it loads without an error or a warning, and its JSON parser reads what it should) and of both together (they press the same keys for each command, and build the same layout), then your own tests in `local\powershell\tests`. |
| `powershell -NoProfile -File powershell\tests\run.ps1 -EndToEnd` | the repository root, on Windows with AutoHotkey v2 and Python | The end-to-end test of both versions, below. `-Case 'Name\|Other'` runs only the cases whose name matches; `-Repeat 12` makes each of the two Calculator series 12 times (2 by default). |

Some tests read your `local/`, so that what you added is checked too: `run.ps1` runs your tests in `local\powershell\tests`; `Config.Tests.ps1` checks your `local\config.json` as well as the example, with your commands in `local\powershell\commands` loaded; and the AutoHotkey load test loads `ahk\main.ahk`, which includes your `local\ahk\commands.ahk`. The end-to-end test never loads anything from `local/`: it runs from a copy without it. The configurator's tests and the script tests do not read it.

### The end-to-end test

`powershell\tests\EndToEnd.Tests.ps1` starts the real macropad, the AutoHotkey version and then the PowerShell one, from a copy of `ahk`, `powershell` and `img` in a temporary folder (so your own commands in `local/` are not loaded), with a test layout, presses the macro keys with `SendInput` as a keyboard would, and checks what happened: a program window that opened and is active, a file that a fixture script wrote, a window that moved, or the exact keys that a stand-in window received. Every command of `ahk/commands` and `powershell/commands` is covered (its case runs wherever the test runs), conditional (its case needs something a PC may lack, such as a second monitor, and says what) or excluded with the reason (the power commands lock or shut down the PC); the table is `powershell/tests/helpers/EndToEndCases.ps1`, the fixtures are in `ahk/tests/e2e`. No real Chrome, PuTTY, VS Code or Visual Studio is used: small stand-in windows run under Chrome's and PuTTY's names, and the keys of the VS Code and Visual Studio commands go into a stand-in in front, which records them.

`run.ps1 -EndToEnd` always starts a PowerShell process for the test, whatever shell you call it from, and the test refuses to run in any other process: its banner watches that process and cleans up when it has ended, so the process must end when the run does. Anywhere else the desktop cases skip themselves and name the command; under `-Ci` they fail instead, so that a build cannot pass with no case run.

While it runs, for a few minutes, the test has the keyboard, the mouse and the screen. It:

- shows a banner at the top of the screen for the whole run, three seconds before the first key;
- stops any macropad that runs, of either language, and starts each again at the end from its own command line and folder, also when a case fails (when the test process dies, the banner runs the clean-up below and stays up while it works), never twice: a macropad of the same script that already runs is not started again;
- opens and closes small dark stand-in windows, File Explorer, PowerShell and Command Prompt, Settings, Notepad, Control Panel and message boxes; opens and closes Calculator a few times per macropad (two series, one of second presses while it starts and one of closing and opening it again, each made twice by default; `-Repeat N` makes that N times, and a second press that came too late is made again, so `-Repeat 12` opens it 26 to 50 times per macropad); snaps, maximizes and minimizes a stand-in; shows Task View and the screen capture once per macropad, and the desktop with two presses per macropad; makes a virtual desktop, switches to and fro, and closes it, once per macropad;
- moves the mouse pointer for the delayed-click form, and puts it back.

A case does not run, saying why, where it would act on a window of yours: for example while your own File Explorer, Notepad or Settings window is open. Close those windows first for a full run. Under `-Ci` such a window fails the case instead, since the CI desktop must be clean. Only windows the command itself could pick count (visible ones, as its helper looks for them), so a hidden console is not one. A key is pressed only into the window the case names, never into whatever is in front: on your desktop, if another window has the keyboard, the case fails and says which, and nothing takes the keyboard back from you; only under `-Ci` is a window of Windows' own shell that came up by itself (Snap Assist, the desktop) put away once. The exceptions are keys that no window gets: Fn, the layer keys and the exit key, which the macropad's own hook takes, and the shell's own chords, Win+Ctrl+Left, Right and F4 to reach and close a virtual desktop the test made and Win+D to bring back the windows after Show Desktop. A conditional case does not run where what it needs is missing (Task Manager and Services need a standard user: for an administrator they would ask for or take elevation; Task View needs an English display language, since only its translated title tells it from Snap Assist and Alt+Tab; Settings and Calculator need none, since their windows are found by application id; `OpenPowershell` needs a desktop with no PowerShell window that is not the test's, since the key would bring that one forward, and on the Jenkins agent the agent's own console is such a window; the second press while Calculator starts needs a machine on which Calculator's first window is still kept off the screen when the press comes, which the case measures as it runs). The run ends by listing every case that did not run, with the reason. It also lists every wait that was met only after two thirds of its limit, with the case and the place that asked for it: on a slower machine that wait is the next to fail.

A window is the test's when a case saw its own key bring it and recorded it then, and the test closes those. A window that came up after a key but that the test cannot tie to it (one that never came forward, or a second Calculator) is left open on your desktop, and the run says so; under `-Ci`, where nobody else is at the desktop, it is closed.

There is one clean-up, and every run ends through it. A run that reaches its end runs it on its own folder. A run that did not end itself (a crash, a Jenkins abort) is cleaned up by its banner, by the next run, or at once by `powershell -NoProfile -File powershell\tests\run.ps1 -EndToEndCleanup`. It ends the run's processes, closes the windows and virtual desktops it opened, lets go of held keys, starts again the macropads it stopped and removes its folder. It touches only what the run's state file shows is still the run's: each process by its pid and start time, each window by its handle, process and class, each virtual desktop the test made by its id. Everything a run starts works in the run's folder (the test itself, its stand-in windows, the macropads under test and through them whatever a command starts; the banner works in the temporary folder), never in the checkout the test was called from. A process that runs from the run's folder or works in it and that started after the run's test did (a program a command started and that outlived its window) is the run's too: it is ended, and the clean-up says which, with its start time, its parent, its working directory and its command line, since the folder cannot be removed while it lives. One that started before the run did (your own shell, standing in a kept folder) is left alone, and named when the folder cannot be removed. A window is closed when it is off the screen: some programs keep a closed window, hidden, for a while. What it cannot check (a process whose start time cannot be read) it leaves alone and reports. What it could not do stays in the state file, and the folder with it, for the next clean-up to try again: the folder is removed only when every step succeeded. Of a folder from before Windows last restarted, no process or window it names is touched (they ended with Windows): the macropads that run stopped are started again, the folder is removed, and a virtual desktop it names that is still there is reported, to close by hand. A state file that does not say when Windows had started is treated the same way, but reported as a problem: nothing says that what it names has ended. A lock that a crashed clean-up left is reported and cleared. One clean-up works on a run at a time; another waits for it, then looks at what is left. Whenever it changes the screen a banner is up: the run's own, which goes last, or one the clean-up shows for as long as it works. It exits 1 when anything was not done; what it cleared is done, whichever run left it. The Jenkins stage runs it before and after the test, and a clean-up that fails fails the build. Before the test it runs it with `-EarlierBuilds`: in a Jenkins build only (never on your desktop, where your shells stand in the checkout) the clean-up first ends every process that runs from the workspace or works in it and that started before the clean-up did, the build's own steps left out, and prints each one. That is what an earlier build left, or an earlier stage of this build in the same workspace (the Pester stage, on the same machine); it is cleared, not held against the end-to-end test. The stage starts even when the workspace cannot be removed because such a process still works in it: it checks out into the folder and removes what is not part of the checkout.

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

A change to the width of a side panel can move the pad by half a pixel at the tests' window size, which makes every picture one pixel wider. Run this suite after such a change too.

The tests that the header fits on one row (`the header, drawn with the fonts of Windows` in `src/ui/layout.browser.test.tsx`) skip themselves off Windows for the same reason: a wider font wraps the header, as it is built to do.

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
5. On every branch: runs the Pester suite (`run.ps1 -Ci`) on the Windows agent (`windows-x64`).
6. On every branch: runs the end-to-end test on the Windows agent with a real desktop (`windows-desktop`).
7. Sends everything to SonarQube, with the coverage of the unit and the browser tests, and waits for the quality gate.
8. On `develop` only: packages the desktop app on the Windows agent (`windows-x64`), and builds the Linux images for both architectures, starting each one to check that it serves the page. The arm64 image is started on the arm64 agent (`linux-arm64`).
9. On `develop` only: publishes all of it as a release. [releasing.md](releasing.md) has the version scheme and the order of the steps.

The `Jenkinsfile` header lists the globals, such as `OMB_NTFY_URL` for build notifications.

The Jenkins job is a multibranch pipeline defined in `ci/jenkins-job.xml`. It checks out over SSH and scans for new commits every 2 minutes. To create it, or update it after editing the XML, put `JENKINS_URL` and `JENKINS_CREDENTIALS_ID` in `local/ci/jenkins.env` and run:

```
JENKINS_USER=<user> JENKINS_TOKEN=<api token> sh ci/create-jenkins-job.sh
```

The first analysis creates the SonarQube project `hotdog-Studio_open-macro-builder` if the Jenkins token may create projects. Otherwise, create it in SonarQube first.
