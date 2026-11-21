# How the configurator is put together

The configurator (`configurator/`) is one React app that runs two ways: in a browser tab, and inside an Electron window as the desktop app. This page is the map. For setup and tests, see [development.md](development.md).

## The layers

```
src/ui        what you see: the tabs, the pad grid, the dialogs
src/state     what is open and what has changed: one reducer, and the actions that load and save
src/platform  how a folder is opened and remembered: one interface, a browser and an Electron version
src/core      the rules: reading, checking, editing and writing the layout and the command files
electron/     the desktop shell: the window, and file access on behalf of the page
```

Each layer uses only the ones below it.

### `src/core`: the rules

Plain TypeScript with no React, no browser and no Node in it. ESLint enforces that (`eslint.config.js`), which is why all of it can be unit-tested without a screen.

- `config/`: the layout. `parse.ts` reads `config.json` into a `Workspace` (`model.ts`), `ops.ts` holds every edit as a function from one workspace to the next (move a key, swap two layers, set a macro), `validate.ts` checks it, and `write.ts` turns it back into JSON.
- `folder/`: `FolderAccess`, the four things the app needs from a folder: read a file, write a file, list a directory, remove a file. Everything above reads and writes through it. `memory.ts` is the in-memory version the tests use.
- `languages/`: what the app knows about AutoHotkey and PowerShell: finding the command functions in a file, and building the catalog of commands from both languages' folders. The parsers also read a function's doc block (`/** */` in AutoHotkey, `<# #>` or a run of `#` notes in PowerShell) and build its usage line, and `scanLibrary` reads the library: the `.ps1` files directly in `powershell/lib`, not its subfolders (AutoHotkey has no library folder). It reads each file's functions with the same parser as a command file, and takes the file's title from its first line when that is a `#` comment other than `#requires`, `#region` or `#endregion`, else from the file name. Command files come in pairs: the AutoHotkey file and the PowerShell file of the same name, such as `media.ahk` and `media.ps1`. Library files are not matched up that way; each is read on its own.
- `commands/dictionary.ts`: what a command file can call. `buildDictionary` lists the functions of the file shown, then your other command files, then the shared ones, then the library, then the bundled reference of the language's own functions, and a name resolves to the first of them (unsaved text stands in for its file). So a function of the folder named like a built-in wins in the card, as it does in AutoHotkey, which calls the script's function in place of its own. `listSections` groups the same entries for the right panel: the folder's functions to call, the commands of other files, and the reference's groups last. An entry's source (`DictSource`) is a file and a line, or the reference, with the function's page and what the PowerShell version uses in its place.
- `commands/reference.ts`, `commands/ahkReference.ts` and `commands/reference/autohotkey.ahk`: the bundled reference of AutoHotkey's own functions that a macropad uses: the ones `powershell/docs/ahk-builtins.md` names, except the 12 that `reference.test.ts` lists with the reason each has none; every one the shared command files call or the reference's own examples call; and everyday text functions. A built-in that a function of the shared scripts hides is one of those 12, since the scripts can never reach it: `Shutdown`, hidden by the `Shutdown` command of `ahk/commands/power.ahk`. The `.ahk` file is a declarations file, never run: an empty function per built-in under a `/** */` block, read by the same parser as a command file, so it comes with the app and never goes into a folder, whatever the folder's age. It has three tags of its own: `@group` (the heading it is listed under, one of `REFERENCE_GROUPS`), `@powershell` (what the PowerShell version uses, from `ahk-builtins.md`) and `@see` (its page at autohotkey.com/docs/v2). `readReference` (`reference.ts`) reads it, ordered by group. `ahkReference.ts` imports the file as text (`?raw`) and holds the result, `AHK_REFERENCE`; only `loadAhkReference` (`state/ahkReference.ts`) imports that module, on demand, as `loadStarter` does the starter, so the reference is a chunk of its own that the page fetches when the Commands tab first shows. Until it has come, the card and the list go without it; when it cannot be fetched, they stay without it. `state/ahkReference.test.ts` fails when a static import from `main.tsx` reaches it, and `reference.test.ts` checks every entry and fails when a shared command file, or an example, starts to call a built-in that has none.
- `overlay.ts`: where each key sits on the overlay, shared by the grid and the preview.
- `links.ts`: the addresses the desktop app may hand to the default browser, and `isAllowedLink`, which the desktop shell asks before it opens one.
- `starter.ts`: `writeStarter` copies the starter files into an empty folder through `FolderAccess`, then the manifest (below), and `config.json` last, so a copy that stopped part-way is not mistaken for a finished one. `repo.ts` (`inspectFolder`) tells an empty folder apart from a setup and from anything else.
- `update/`: bringing the scripts of a folder up to date from the app's copy. `fingerprint.ts` gives a file's fingerprint: the SHA-256 of its bytes with each CRLF read as LF (`.png` and `.ico` files as they are), and for `ahk/config.ahk` without the lines that include a shared command file. `canonical.mjs` holds those bytes' rule in plain JavaScript, because the build script uses it too. `manifest.ts` reads and writes the manifest, `history.ts` reads the known releases, and `version.ts` compares versions. `plan.ts` (`planUpdate`) compares a folder with the app's copy and says what an update would replace, add and remove, and which files the person changed or deleted; it writes nothing. `apply.ts` (`applyUpdate`) carries a plan out, and `includeList.ts` reads and edits the `#Include` lines of `ahk/config.ahk`. That file counts as changed by the person when its body differs, or when an AutoHotkey command file in the folder (a shared one or one of the person's own) has no `#Include` line in it: the person switched that command off. Two are not counted: a command file the update removes, which the folder will not hold afterwards, and a command file of the app's copy that the folder holds as the app has it but had no record of (the manifest names it as deleted, or in neither its files nor its offers; without a manifest, no release shipped it), which mainly an update that stopped before writing `ahk/config.ahk` leaves without its line; the update puts that line in. An untouched `ahk/config.ahk` is rewritten with a line for each command file the folder will hold; a changed one is kept, and only gets a line for each command file the update adds and loses the line of each it removes. `apply.ts` reads the file again just before writing, and keeps it when a line was taken out since the plan.

The starter is `config.json`, `ahk/`, `powershell/` and `img/` of the repository, without any `tests` or `local` folder and without `.xcf`, `.bak` and `.omb-tmp` files. `configurator/scripts/starter.mjs` is a Vite plugin that reads them at build time and serves them as the virtual module `virtual:omb-starter`; `state/starter.ts` (`loadStarter`) imports it on demand, so the page fetches that separate chunk (about 1.3 MB) only when a folder is set up or updated. A second module, `virtual:omb-starter-index` (`loadStarterIndex`), holds only the version of the app's copy and the fingerprint of each file, which is all a check needs. The version is `APP_VERSION` when the build is given one, else `<MAJOR>.<MINOR>.0-dev` from `configurator/package.json`.

The checks in `validate.ts` are the repository's own validator, `scripts/validate-config-core.mjs`, imported from outside `configurator/`. The configurator and `node scripts/validate-config.mjs` therefore cannot disagree about what a valid layout is.

#### The manifest and the known releases

A folder the configurator set up or updated holds `omb-manifest.json` in its root: the version of the app that last wrote its shared files; for each shared file, the fingerprint of the app's copy it last wrote or found there (a changed file the person kept keeps its earlier entry, if it had one); the command files the person deleted (through the Commands tab, or, in a folder from before the manifest, missing at its first update and not ticked), and those the update found gone when it looked again just before writing; and, for each changed file the person kept at an update, the fingerprint of the app's copy they were offered then. A file that still has the manifest's fingerprint is untouched. The Commands tab records there a delete of any file in `ahk/commands` or `powershell/commands`, whether or not the manifest names that file among its files (`state/commandActions.ts`), and takes the entry out when the file is created again. The starter never carries a manifest, and `.gitignore` names it.

Folders set up by 1.0.2 to 1.0.5 have no manifest. For them, `update/knownReleases.json` holds the fingerprints of every file those releases shipped, made from the release tags by `node configurator/scripts/starter-history.mjs`. A file with one of them is an untouched file of that release, and a missing command file that a release shipped counts as deleted by the person.

Versions compare as three numbers, and `-dev` adds nothing, so a development build counts as the first release of its line (`<MAJOR>.<MINOR>.0`) and older than every later one. It never offers its scripts to a folder a later release of its line wrote: a folder whose manifest names a version newer than the app's, or, without a manifest, whose files are of a newer release and differ from the app's copy, gets a notice saying so and no update. A folder the `.0` release wrote counts as the same version, so where its files differ from the build's they are offered.

### `src/platform`: opening a folder

`Platform` (`types.ts`) is what differs between the two ways of running: opening a folder, restoring the one from last time, and, in the desktop app only, watching files, finding and reloading the running macropad, and checking a command file's syntax. `detect.ts` picks the version at startup.

- `browser.ts` uses the File System Access API (`showDirectoryPicker`) and remembers the folder handle in IndexedDB. Only Chromium browsers have that API, and only on `https://` or `localhost`.
- `electron.ts` talks to the desktop shell through `window.omb`, the bridge the preload script exposes.

`createFolder(name)` makes a new folder and opens it: the browser version asks for the place with `showDirectoryPicker` and creates `<place>/<name>`, the desktop app shows a native folder picker and does the same (`electron/ipc.ts`).

### `src/state`: what is open

`store.tsx` holds the state in one reducer: which screen is showing, the workspace being edited, the workspace as last saved, the selected key and layer, and the dialogs. `actions.ts` has everything that takes time: opening and restoring a folder, saving with a check that the file has not changed on disk, reloading. The command files have their own slice and actions. The `loaded` action carries the tab the editor opens on: Pad shape, or Get started straight after a fresh setup.

An edit is always `dispatch({ type: 'edit', ws: someOp(ws, ...) })`: an operation from `core/config/ops.ts` makes the next workspace, and the reducer keeps it.

`updateActions.ts` holds the update. Once a folder has opened, `opened` in `actions.ts` starts its check in the background, so opening never waits for it: it runs `planUpdate` against the app's copy and sets the state's `update` when there is something new to offer, or shows a notice when the folder is newer than the app. A folder with a `.git` entry in its root is never checked. Pressing **Update** waits for the Commands tab's work in flight, makes the plan again, loads the app's files and runs `applyUpdate`; nothing may open, close or reload a folder until the outcome is shown. Afterwards the shared files are scanned again, as after a change from outside.

### `src/ui`: what you see

One file per tab (`GetStarted`, `ShapeTab`, `LayersTab`, `MacrosTab`, `CommandsTab`), plus the pieces they share.

`GetStarted.tsx` is the guide for newcomers. `OpenScreen.tsx` shows it too, before any folder is open, so it reads only what `useApp()` gives and takes the folder's name and the versions to describe as props.

`Toast.tsx` shows the one message the store holds (`banner`) as a floating toast. A notice or a refused action leaves by itself. A failure stays until dismissed, and so does a notice raised while a folder loads.

`UpdateNotice.tsx` is the bar that says a folder's scripts are older than the app's, with **Review the update** and **Not now**. It floats at the top of the content area, under the changed-on-disk bar (`OutsideChangeBar` in `SaveFlow.tsx`) and above the message: the three stand in one stack in `App.tsx` that takes no room and no clicks (only the bars and the message in it do), so nothing in the page moves when one comes or goes. `UpdateDialog.tsx` is the dialog behind it: what the update would replace, add and remove, a tick box for each file the person changed or deleted, then what came of it. While the dialog is open, everything behind it is `inert` (`App.tsx`).

`DocCard` (`code/DocCard.tsx`) is the one card of a function's docs; for a function of the reference it ends with what the PowerShell version uses and the page's address, as text. `hoverDocs` shows it over a name in the code editor. In the right panel, `DocHover.tsx` owns the one card for both of its lists, the outline of the file's commands and `OtherCommands` (what a command can call): `CommandsTab` wraps both in its `DocHoverProvider`, each row asks for the card through `useDocHover`, and the card is shown beside the panel, so a row of one list never leaves a card of the other up.

`PadGrid.tsx` draws the pad on all three pad tabs and owns the drag and drop, built on [dnd-kit](https://dndkit.com/):

- `dnd.ts` decides what a drop means (`dropAction`) and carries it out (`applyDrop`). It is plain functions, tested without a browser. The keyboard goes through the same functions (`nudgeAction`), so a drag and its keyboard equivalent cannot drift apart.
- `collide` in `PadGrid.tsx` decides what the pointer is over. A key being moved lands on the square nearest its top-left corner; anything else lands on what is under the pointer, counting a key's label strip and the small gap around it, and ignoring anything scrolled out of sight behind a side panel.

### `electron/`: the desktop shell

- `main.ts` creates the window: sandboxed, context-isolated, no Node in the page, navigation and new windows refused. A link on the list in `src/core/links.ts` is passed to the default browser, and its window is refused like any other.
- `preload.ts` exposes `window.omb`, a small fixed set of functions, and nothing else.
- `ipc.ts` answers them. It accepts calls only from the app's own window, and file paths only inside the folder the user opened.
- `nodeFolder.ts` is `FolderAccess` over the real file system. `macropad.ts` finds and reloads the running macropad, `syntax.ts` checks a command file with its own interpreter, and `watch.ts` reports files that change on disk.

## Following one drag through

Dragging a command onto a key on the Macros tab:

1. dnd-kit reports the drop to `onDragEnd` in `PadGrid.tsx`, with the ids of what was dragged (`cmd:shared/power/Lock`) and what it was dropped on (`key:k4`), the latter chosen by `collide`.
2. `dropAction('macros', ...)` in `dnd.ts` turns the two ids into `{ type: 'setMacroFromCommand', command: 'Lock', key: 'k4' }`.
3. `applyDrop` calls `setMacro` from `core/config/ops.ts`, which returns a new workspace.
4. `dispatch({ type: 'edit', ws })` stores it. The grid redraws, and the header's Save button turns on because the workspace now differs from the saved one.
5. **Save** runs `actions.save()`: validate, check the file on disk is still the one that was loaded, keep the old file as `.bak`, write the new one through `FolderAccess`.

## What the page may not do

The page never touches the file system or the macropad directly. In the browser it has only the folder handle the user granted. In the desktop app it has only `window.omb`, and `ipc.ts` refuses paths outside the opened folder. The image served by the Docker container adds a Content-Security-Policy that allows the page to load only its own files (`docker/Caddyfile`). The desktop window never leaves the app's own page. The only way out is a link on the fixed list in `src/core/links.ts`, which the shell hands to the default browser.
