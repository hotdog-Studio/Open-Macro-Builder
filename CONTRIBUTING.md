# Contributing

Thanks for wanting to improve Open Macro Builder. This page says how to propose a change; [docs/development.md](docs/development.md) says how to set up and run the tests.

## Reporting a problem

Open an issue with:

- which version you run (AutoHotkey or PowerShell) and, for the configurator, whether it is the desktop app, the Docker image or a browser, and which browser;
- what you did, what you expected and what happened;
- the part of your layout that shows it, with anything private taken out.

## Proposing a change

1. Branch from `develop`, which is the branch pull requests go to.
2. Make the change, with tests (see below).
3. Run what CI runs for the part you touched. For the configurator, in `configurator/`: `npm run lint`, `npm test`, `npm run test:browser` and `npm run build`. For the scripts: `node --test "scripts/*.test.mjs"`. For the PowerShell version: `powershell -NoProfile -File powershell\tests\run.ps1`.
4. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) if a user would notice the change.
5. Open a pull request that says what changed and why.

## What a change needs

- **Both versions stay in step.** A command exists in `ahk/commands/` and in `powershell/commands/` under the same name, and `node scripts/validate-config.mjs` checks that every action in `config.json` exists in both. A new command goes into both, and a layout feature is read by both.
- **A test that would have caught it.** A bug fix comes with a test that fails without the fix. In the configurator, logic goes in a `*.test.ts(x)` file and anything that depends on real layout or input (dragging, focus, scrolling) in a `*.browser.test.tsx` file; [docs/development.md](docs/development.md#where-a-configurator-test-goes) has the table.
- **Anything draggable also works from the keyboard.** The configurator's drags all have a keyboard equivalent that goes through the same code (`src/ui/dnd.ts`). Keep it that way.
- **Nothing personal.** Hosts, paths, account names and your own layout belong in `local/`, which git ignores. Tests never read `local/`. The git hooks in [docs/development.md](docs/development.md#keeping-private-details-out-of-git) stop a deny-listed string from being committed.

## Style

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) with the part of the project as the scope: `fix(configurator): ...`, `feat(powershell): ...`, `test(configurator): ...`, `docs: ...`.
- Comments say why, in plain words. Test names say what the user sees: "a layer dropped on the Fn key stays where it was".
- The configurator's `src/core` stays free of React, the browser and Node; ESLint enforces it.

## License

By contributing you agree that your contribution is licensed under the [GNU General Public License v3](LICENSE), like the rest of the project.
