# Contributing

Thanks for wanting to improve Open Macro Builder. This page says how to propose a change; [docs/development.md](docs/development.md) says how to set up and run the tests.

## Reporting a problem

Open an issue with:

- which version you run (AutoHotkey or PowerShell) and, for the configurator, whether it is the desktop app, the Docker image or a browser, and which browser;
- what you did, what you expected and what happened;
- the part of your layout that shows it, with anything private taken out.

## Proposing a change

1. Fork the repository on GitHub and clone your fork. If you cloned this repository itself, add your fork as a second remote and push to that.
2. Branch from `develop`, which is the branch pull requests go to.
3. Make the change, with tests (see below).
4. Run what CI runs for the part you touched. For the configurator, in `configurator/`: `npm run lint`, `npm test`, `npm run test:browser` and `npm run build`, and on Windows, when you changed the desktop app, `npm run test:electron` (it opens the app's window). For the scripts: `node --test "scripts/*.test.mjs"`. For either version of the macropad: `powershell -NoProfile -File powershell\tests\run.ps1`, which tests the PowerShell version and checks the AutoHotkey one, Integration tests included, and, when you changed a command or a helper, the end-to-end test, `powershell -NoProfile -File powershell\tests\run.ps1 -EndToEnd` (it takes your keyboard, mouse and screen for a few minutes; `-Case` runs only some cases; [docs/development.md](docs/development.md#the-end-to-end-test) says what it needs). CI runs all of these on every branch ([docs/development.md](docs/development.md#ci) lists its stages): the Pester suite with `-Ci`, which leaves the Integration tests out, on the Windows agent, and the Integration tests (`-Integration`), the end-to-end test and the configurator's three suites on the Windows agent with a real desktop. The end-to-end cases that need something that desktop lacks, such as a second monitor, run only where you run them.
5. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) if a user would notice the change.
6. Open a pull request that says what changed and why.

## What a change needs

- **Both versions stay in step.** A command exists in `ahk/commands/` and in `powershell/commands/` under the same name, and `node scripts/validate-config.mjs config.json` checks that every action in the example `config.json` exists in both, as CI does. Without a path it checks the layout both versions would load, which is your `local/config.json` when you have one. A new command goes into both, and a layout feature is read by both. Every AutoHotkey command has a `/** */` doc block that says what it does, and a PowerShell function meant for commands has a help block ([powershell/README.md](powershell/README.md) has the form).
- **A test that would have caught it.** A bug fix comes with a test that fails without the fix. A new command also gets a case in the end-to-end test's table (`powershell/tests/helpers/EndToEndCases.ps1`), or an exclusion there with the reason; CI fails a command that has neither. In the configurator, logic goes in a `*.test.ts(x)` file and anything that depends on real layout or input (dragging, focus, scrolling) in a `*.browser.test.tsx` file; [docs/development.md](docs/development.md#where-a-configurator-test-goes) has the table.
- **Anything draggable also works from the keyboard.** The configurator's drags all have a keyboard equivalent that goes through the same code (`src/ui/dnd.ts`). Keep it that way.
- **Nothing personal.** Hosts, paths, account names and your own layout belong in `local/`, which git ignores. Some tests read it, so that what you added there is checked too: the Pester suite runs your tests in `local/powershell/tests`, and checks your `local/config.json` and your commands with the rest. The end-to-end test never loads it, and the configurator's and the scripts' tests do not read it. The git hooks in [docs/development.md](docs/development.md#keeping-private-details-out-of-git) stop a deny-listed string from being committed.

## Style

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) without a scope, as the history has them: `fix: ...`, `feat: ...`, `test: ...`, `docs: ...`, `ci: ...` or `build: ...`, with a subject that says what is now true, such as `fix: saving a file with both kinds of line ending changes only the lines that were edited`.
- Comments say why, in plain words. Test names say what the user sees: "a layer dropped on the Fn key stays where it was".
- The configurator's `src/core` stays free of React, the browser and Node; ESLint enforces it.

## License

By contributing you agree that your contribution is licensed under the [GNU General Public License v3](LICENSE), like the rest of the project.
