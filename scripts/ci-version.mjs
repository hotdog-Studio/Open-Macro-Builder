#!/usr/bin/env node
// The version of the commit being built, as MAJOR.MINOR.PATCH.
//
//   MAJOR.MINOR  is the maintainer's: the first two numbers of "version" in
//                configurator/package.json. Only a commit that edits that file changes them.
//   PATCH        comes from git tags: the newest v<MAJOR>.<MINOR>.<patch> tag reachable from HEAD
//                plus one, or 0 when that line has no tag yet. Jenkins pushes one tag for each
//                green build of develop (scripts/ci-release.mjs), so tags are the record of what
//                was released and nothing is written back to the repository.
//
// HEAD sitting on the newest tag of its line is a rebuild of that release and keeps its number.
//
//   node scripts/ci-version.mjs          the version of HEAD, for example 1.0.4
//   node scripts/ci-version.mjs --base   the tag the patch counts from, or (none)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** "1.0" from a package.json version "1.0.0". Throws when it is not MAJOR.MINOR.PATCH. */
export function lineOf(pkgVersion) {
  const parts = VERSION.exec(pkgVersion ?? '');
  if (!parts) throw new Error(`configurator/package.json version "${pkgVersion}" is not MAJOR.MINOR.PATCH`);
  return `${parts[1]}.${parts[2]}`;
}

/**
 * The version to build. `merged` are the tag names reachable from HEAD and `atHead` the ones that
 * point at HEAD. Returns `{ version, base }`, where `base` is the tag counted from or null.
 */
export function versionFor({ pkgVersion, merged, atHead }) {
  const line = lineOf(pkgVersion);
  const prefix = `v${line}.`;
  const patches = merged
    .filter((tag) => tag.startsWith(prefix) && /^\d+$/.test(tag.slice(prefix.length)))
    .map((tag) => Number(tag.slice(prefix.length)));
  if (patches.length === 0) return { version: `${line}.0`, base: null };
  const last = Math.max(...patches);
  const base = `${prefix}${last}`;
  const patch = atHead.includes(base) ? last : last + 1;
  return { version: `${line}.${patch}`, base };
}

const lines = (text) => text.split(/\r?\n/).filter((line) => line !== '');

/** Runs the command line. `git(args)` returns git's output and `read(path)` a file's text. */
export function main(argv, { git, read, log, error }) {
  const [flag, ...rest] = argv;
  if (rest.length > 0 || (flag !== undefined && flag !== '--base')) {
    error('usage: node scripts/ci-version.mjs [--base]');
    return 2;
  }
  try {
    const pkgVersion = JSON.parse(read('configurator/package.json')).version;
    const merged = lines(git(['tag', '--merged', 'HEAD', '--list', 'v[0-9]*']));
    const atHead = lines(git(['tag', '--points-at', 'HEAD', '--list', 'v[0-9]*']));
    const { version, base } = versionFor({ pkgVersion, merged, atHead });
    log(flag === '--base' ? (base ?? '(none)') : version);
    return 0;
  } catch (error_) {
    error(error_.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  // The git on PATH, as in scripts/check-private.mjs: there is no fixed git location across the
  // build machines, and whoever controls PATH on one already controls the build (hence NOSONAR).
  process.exitCode = main(process.argv.slice(2), {
    git: (args) => execFileSync('git', args, { cwd: root }).toString(), // NOSONAR S4036
    read: (path) => readFileSync(join(root, path), 'utf8'),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
