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
- `languages/`: what the app knows about AutoHotkey and PowerShell: finding the command functions in a file, and building the catalog of commands from both languages' folders.
- `overlay.ts`: where each key sits on the overlay, shared by the grid and the preview.

The checks in `validate.ts` are the repository's own validator, `scripts/validate-config-core.mjs`, imported from outside `configurator/`. The configurator and `node scripts/validate-config.mjs` therefore cannot disagree about what a valid layout is.

### `src/platform`: opening a folder

`Platform` (`types.ts`) is what differs between the two ways of running: opening a folder, restoring the one from last time, and, in the desktop app only, watching files, finding and reloading the running macropad, and checking a command file's syntax. `detect.ts` picks the version at startup.

- `browser.ts` uses the File System Access API (`showDirectoryPicker`) and remembers the folder handle in IndexedDB. Only Chromium browsers have that API, and only on `https://` or `localhost`.
- `electron.ts` talks to the desktop shell through `window.omb`, the bridge the preload script exposes.

### `src/state`: what is open

`store.tsx` holds the state in one reducer: which screen is showing, the workspace being edited, the workspace as last saved, the selected key and layer, and the dialogs. `actions.ts` has everything that takes time: opening and restoring a folder, saving with a check that the file has not changed on disk, reloading. The command files have their own slice and actions.

An edit is always `dispatch({ type: 'edit', ws: someOp(ws, ...) })`: an operation from `core/config/ops.ts` makes the next workspace, and the reducer keeps it.

### `src/ui`: what you see

One file per tab (`ShapeTab`, `LayersTab`, `MacrosTab`, `CommandsTab`), plus the pieces they share.

`PadGrid.tsx` draws the pad on all three pad tabs and owns the drag and drop, built on [dnd-kit](https://dndkit.com/):

- `dnd.ts` decides what a drop means (`dropAction`) and carries it out (`applyDrop`). It is plain functions, tested without a browser. The keyboard goes through the same functions (`nudgeAction`), so a drag and its keyboard equivalent cannot drift apart.
- `collide` in `PadGrid.tsx` decides what the pointer is over. A key being moved lands on the square nearest its top-left corner; anything else lands on what is under the pointer, counting a key's label strip and the small gap around it, and ignoring anything scrolled out of sight behind a side panel.

### `electron/`: the desktop shell

- `main.ts` creates the window: sandboxed, context-isolated, no Node in the page, navigation and new windows refused.
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

The page never touches the file system or the macropad directly. In the browser it has only the folder handle the user granted. In the desktop app it has only `window.omb`, and `ipc.ts` refuses paths outside the opened folder. The image served by the Docker container adds a Content-Security-Policy that allows the page to load only its own files (`docker/Caddyfile`).
