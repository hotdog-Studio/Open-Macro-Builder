// node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineOf, versionFor, main } from './ci-version.mjs';

test('the line is the first two numbers of the package version', () => {
  assert.equal(lineOf('1.0.0'), '1.0');
  assert.equal(lineOf('2.13.7'), '2.13');
});

test('a package version that is not three numbers is refused', () => {
  assert.throws(() => lineOf('1.0'), /not MAJOR.MINOR.PATCH/);
  assert.throws(() => lineOf('1.0.0-beta'), /not MAJOR.MINOR.PATCH/);
  assert.throws(() => lineOf(undefined), /not MAJOR.MINOR.PATCH/);
});

test('the first build of a line is patch 0', () => {
  assert.deepEqual(versionFor({ pkgVersion: '1.0.0', merged: [], atHead: [] }), { version: '1.0.0', base: null });
});

test('each build after a tag takes the next patch', () => {
  const merged = ['v1.0.0', 'v1.0.1', 'v1.0.2'];
  assert.deepEqual(versionFor({ pkgVersion: '1.0.0', merged, atHead: [] }), { version: '1.0.3', base: 'v1.0.2' });
});

test('patches are compared as numbers, so 10 comes after 9', () => {
  const merged = ['v1.0.9', 'v1.0.10'];
  assert.equal(versionFor({ pkgVersion: '1.0.0', merged, atHead: [] }).version, '1.0.11');
});

test('a rebuild of the newest tag keeps its number', () => {
  const merged = ['v1.0.0', 'v1.0.1'];
  assert.deepEqual(versionFor({ pkgVersion: '1.0.0', merged, atHead: ['v1.0.1'] }), { version: '1.0.1', base: 'v1.0.1' });
});

test('a new minor in package.json starts again at patch 0, whatever older lines reached', () => {
  const merged = ['v1.0.0', 'v1.0.7'];
  assert.deepEqual(versionFor({ pkgVersion: '1.1.0', merged, atHead: ['v1.0.7'] }), { version: '1.1.0', base: null });
});

test('tags of other lines and tags that are not a patch number are ignored', () => {
  const merged = ['v1.0.2', 'v1.0.x', 'v1.0.3-rc', 'v10.0.5', 'v2.0.9', 'v1.0.'];
  assert.equal(versionFor({ pkgVersion: '1.0.0', merged, atHead: [] }).version, '1.0.3');
});

// Runs main() against made-up git output: { code, out, err }.
function run(argv, { pkg = '{ "version": "1.0.0" }', merged = '', atHead = '' } = {}) {
  const out = [];
  const err = [];
  const code = main(argv, {
    git: (args) => (args.includes('--merged') ? merged : atHead),
    read: () => pkg,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return { code, out, err };
}

test('the command prints the version of HEAD', () => {
  assert.deepEqual(run([], { merged: 'v1.0.0\r\nv1.0.1\n' }), { code: 0, out: ['1.0.2'], err: [] });
});

test('--base prints the tag counted from, or (none)', () => {
  assert.deepEqual(run(['--base'], { merged: 'v1.0.0\nv1.0.1\n' }).out, ['v1.0.1']);
  assert.deepEqual(run(['--base']).out, ['(none)']);
});

test('the command asks git only for version tags, reachable from and pointing at HEAD', () => {
  const asked = [];
  const git = (args) => {
    asked.push(args.join(' '));
    return '';
  };
  main([], { git, read: () => '{ "version": "1.0.0" }', log: () => {}, error: () => {} });
  assert.deepEqual(asked, ['tag --merged HEAD --list v[0-9]*', 'tag --points-at HEAD --list v[0-9]*']);
});

test('an unknown argument is a usage error', () => {
  assert.equal(run(['--nope']).code, 2);
  assert.equal(run(['--base', 'more']).code, 2);
  assert.match(run(['--nope']).err[0], /usage/);
});

test('a bad package version fails with the reason', () => {
  const result = run([], { pkg: '{ "version": "one" }' });
  assert.equal(result.code, 1);
  assert.match(result.err[0], /not MAJOR.MINOR.PATCH/);
});
