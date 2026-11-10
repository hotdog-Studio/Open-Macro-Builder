// node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, commandNames, repoChecks, activeConfigPath, main } from './validate-config.mjs';

// A throwaway repository root holding the given files.
function tempRoot(files) {
  const dir = mkdtempSync(join(tmpdir(), 'omb-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

test('loads OMB_CONFIG, else local/config.json, else the example config.json', () => {
  const plain = tempRoot({ 'config.json': '{}' });
  const withLocal = tempRoot({ 'config.json': '{}', 'local/config.json': '{}' });
  try {
    assert.equal(activeConfigPath(plain, {}), join(plain, 'config.json'));
    assert.equal(activeConfigPath(withLocal, {}), join(withLocal, 'local', 'config.json'));
    assert.equal(activeConfigPath(withLocal, { OMB_CONFIG: 'x.json' }), 'x.json');
  } finally {
    rmSync(plain, { recursive: true }); rmSync(withLocal, { recursive: true });
  }
});

test('counts your own commands in local/ as defined', () => {
  const dir = tempRoot({
    'ahk/commands/a.ahk': 'Shared(Macro) {\n}\n',
    'powershell/commands/a.ps1': 'function Shared { }\n',
    'local/ahk/mine.ahk': 'Mine(Macro) {\n}\n',
    'local/powershell/commands/mine.ps1': 'function Mine { }\n',
  });
  try {
    const checks = repoChecks(dir);
    assert.ok(checks.ahkActions.has('shared') && checks.ahkActions.has('mine'));
    assert.ok(checks.psActions.has('shared') && checks.psActions.has('mine'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function layout(overrides = {}) {
  return {
    fn: { key: 'ScrollLock', row: 2, col: 1, width: 2 },
    keys: [{ key: 'F13', row: 1, col: 1 }, { key: 'F14', row: 1, col: 2 }],
    layers: [{ title: 'A', icon: 'chrome', macros: [{ action: 'Act', name: 'One' }, null] }],
    default: 1,
    showFn: ' ',
    iconAction: 'Layer',
    hotkeys: [],
    hotstrings: [],
    ...overrides,
  };
}
const both = { ahkActions: new Set(['act']), psActions: new Set(['act']) };

test('accepts the repository config.json', () => {
  const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  assert.deepEqual(validateConfig(config, repoChecks(root)), []);
});

test('accepts a small valid layout', () => {
  assert.deepEqual(validateConfig(layout(), both), []);
});

test('reports more layers than keys, not counting disabled ones', () => {
  const layers = [null, { title: 'A', icon: 'chrome', macros: [] }, { title: 'B', icon: 'chrome', macros: [] }];
  assert.match(validateConfig(layout({ layers }), both).join('\n'), /layers: 3 layers for 2 keys/);
  layers[2].disabled = true;
  assert.deepEqual(validateConfig(layout({ layers }), both), []);
});

test('reports more macros than keys', () => {
  const macros = [null, null, { action: 'Act', name: 'Three' }];
  assert.match(validateConfig(layout({ layers: [{ title: 'A', icon: 'chrome', macros }] }), both).join('\n'), /layers\[0\]\.macros: 3 macros for 2 keys/);
});

test('reports an icon folder that does not exist', () => {
  const errors = validateConfig(layout(), { ...both, iconExists: (name) => name !== 'chrome' });
  assert.match(errors.join('\n'), /layers\[0\]: icon folder "chrome" not found/);
});

test('reports an action missing from either version', () => {
  const errors = validateConfig(layout(), { ahkActions: new Set(['act']), psActions: new Set() });
  assert.deepEqual(errors, ['layers[0].macros[0]: action "Act" is not defined in powershell/commands']);
});

test('ignores actions on disabled layers', () => {
  const layers = [{ title: 'Off', icon: 'chrome', disabled: true, macros: [{ action: 'Gone', name: 'x' }] }];
  assert.deepEqual(validateConfig(layout({ layers }), both), []);
});

test('needs a key name and whole-number positions', () => {
  const errors = validateConfig(layout({ keys: [{ row: 1 }, { key: 'F14', col: 0 }] }), both);
  assert.match(errors.join('\n'), /keys\[0\]: needs a "key" name/);
  assert.match(errors.join('\n'), /keys\[1\]: "col" must be a whole number from 1/);
});

test('checks default and iconAction', () => {
  const errors = validateConfig(layout({ default: 0, iconAction: 'Icon' }), both);
  assert.match(errors.join('\n'), /default: must be a whole number from 1/);
  assert.match(errors.join('\n'), /iconAction: must be "Layer" or "Macro"/);
});

test('requires the X option exactly when a hotstring has an action', () => {
  const errors = validateConfig(layout({
    hotstrings: [{ hotstring: '::go', action: 'Act' }, { hotstring: ':X:now', replacement: 'x' }, { hotstring: ':X:ok', action: 'Act' }],
  }), both);
  assert.deepEqual(errors, [
    "hotstrings[0]: '::go' has an action but no X option",
    "hotstrings[1]: ':X:now' has the X option but no action",
  ]);
});

test('checks hotkey actions in both versions', () => {
  const errors = validateConfig(layout({ hotkeys: [{ hotkey: '^!e', action: 'Missing' }] }), both);
  assert.equal(errors.length, 2);
});

test('finds command names in AutoHotkey and PowerShell files', () => {
  const ahk = commandNames(join(root, 'ahk', 'commands'), '.ahk');
  const ps = commandNames(join(root, 'powershell', 'commands'), '.ps1');
  assert.ok(ahk.has('openyoutube') && ps.has('openyoutube'));
  assert.ok(ps.has('get-explorerwindows'));
});

test('the command line validates a file and sets the exit code', () => {
  const dir = tempRoot({ 'bad.json': '{ nope', 'empty.json': '{}' });
  const out = [];
  const err = [];
  const io = { root, env: {}, log: (l) => out.push(l), error: (l) => err.push(l) };
  try {
    assert.equal(main([join(root, 'config.json')], io), 0);
    assert.match(out[0], /config\.json: OK \(12 keys, \d+ layers/);
    assert.equal(main([join(dir, 'bad.json')], io), 1);
    assert.match(err.at(-1), /^Invalid JSON in /);
    assert.equal(main([join(dir, 'empty.json')], io), 1);
    assert.ok(err.some((l) => /empty\.json: \d+ problem/.test(l)), err.join('\n'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('reports each kind of layout problem', () => {
  const errors = validateConfig({
    fn: { key: 'ScrollLock' },
    keys: [{ key: 'F13' }],
    layers: [5, { title: 'T', icon: 'i', macros: 'x' }, { title: 'T', icon: 'i', macros: [{ name: 'n' }, { action: 'a', name: 'n', icon: 'missing' }] }],
    hotkeys: [{ hotkey: '^a' }],
    hotstrings: [{ hotstring: 'btw' }, { hotstring: '::x' }],
  }, { iconExists: (name) => name !== 'missing' });
  for (const expected of [
    'layers[0]: must be an object or null',
    'layers[1].macros: must be a list',
    'layers[2].macros[0]: needs "action" and "name"',
    'layers[2].macros[1]: icon folder "missing" not found in img/',
    'hotkeys[0]: needs "hotkey" and "action"',
    'hotstrings[0]: needs a "hotstring" such as "::btw"',
    'hotstrings[1]: needs a "replacement"',
  ]) assert.ok(errors.includes(expected), `missing "${expected}" in:\n${errors.join('\n')}`);
  assert.ok(validateConfig({ fn: { key: 'S' }, keys: [{ key: 'F13' }], layers: 'x' }).includes('layers: must be a list'));
});
