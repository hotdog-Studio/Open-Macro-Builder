#!/usr/bin/env node
// Keeps personal details out of git. Reads a deny-list of strings (default local/denylist.txt,
// which git ignores: one case-insensitive substring per line, # starts a comment) and fails when
// any of them appears where git would store or send it. Without a deny-list it checks nothing.
//
//   node scripts/check-private.mjs --staged            staged files (the pre-commit hook)
//   node scripts/check-private.mjs --pre-push          what a push sends (the pre-push hook)
//   node scripts/check-private.mjs --history [revs]    every file, message and author email in
//                                                      the commits git rev-list revs lists (--all)
//
// Exit 0 when clean, 1 with one line per finding otherwise.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The deny-list's entries, lower-cased. */
export function readDenylist(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.toLowerCase());
}

/** Findings in one text: `<where>: line N contains "<entry>"`. Binary content is skipped. */
export function findIn(text, where, denylist) {
  if (text.includes('\0')) return [];
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    for (const entry of denylist) {
      if (lower.includes(entry)) findings.push(`${where}: line ${i + 1} contains "${entry}"`);
    }
  });
  return findings;
}

// Runs the git found on PATH: the same git that runs this script's hooks. SonarQube flags this as
// security hotspot S4036; it is safe here because this is a local developer tool with no fixed
// git location across Windows and Linux, and whoever controls PATH already controls the hooks.
const git = (cwd, args, input) => execFileSync('git', args, { cwd, input, maxBuffer: 1 << 30 });

/** Reads many blobs at once through git cat-file --batch: Map of id -> Buffer. */
function readBlobs(cwd, ids) {
  const blobs = new Map();
  if (ids.length === 0) return blobs;
  const out = git(cwd, ['cat-file', '--batch'], ids.join('\n') + '\n');
  let at = 0;
  for (const id of ids) {
    const headerEnd = out.indexOf(0x0a, at);
    const [, type, size] = out.subarray(at, headerEnd).toString().split(' ');
    const start = headerEnd + 1;
    const end = start + Number(size);
    if (type === 'blob') blobs.set(id, out.subarray(start, end));
    at = end + 1;
  }
  return blobs;
}

/** Every blob, commit message and identity in `revs` (arguments for git rev-list). */
export function checkHistory(cwd, revs, denylist) {
  if (denylist.length === 0) return [];
  const findings = [];
  const objects = git(cwd, ['rev-list', '--objects', ...revs]).toString().split('\n').filter(Boolean);
  const paths = new Map();
  for (const line of objects) {
    const space = line.indexOf(' ');
    if (space > 0) paths.set(line.slice(0, space), line.slice(space + 1));
  }
  const ids = [...paths.keys()];
  const types = git(cwd, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], ids.join('\n') + '\n')
    .toString().split('\n').filter(Boolean).map((l) => l.split(' '));
  const blobIds = types.filter(([, t]) => t === 'blob').map(([id]) => id);
  for (const [id, data] of readBlobs(cwd, blobIds)) {
    findings.push(...findIn(data.toString('utf8'), `${paths.get(id)} (${id.slice(0, 7)})`, denylist));
  }
  for (const [id, path] of paths) findings.push(...findIn(path, `path ${path} (${id.slice(0, 7)})`, denylist));
  const log = git(cwd, ['log', '--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x01', ...revs]).toString();
  for (const entry of log.split('\x01')) {
    const [hash, author, committer, message] = entry.replace(/^\n/, '').split('\0');
    if (!hash) continue;
    const where = `commit ${hash.slice(0, 7)}`;
    findings.push(
      ...findIn(`${author}\n${committer}`, `${where} author/committer`, denylist),
      ...findIn(message ?? '', `${where} message`, denylist),
    );
  }
  return [...new Set(findings)];
}

/** Staged files: their paths and their staged content. */
export function checkStaged(cwd, denylist) {
  if (denylist.length === 0) return [];
  const findings = [];
  const names = git(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString().split('\0').filter(Boolean);
  for (const name of names) {
    findings.push(
      ...findIn(name, `path ${name}`, denylist),
      ...findIn(git(cwd, ['show', `:${name}`]).toString('utf8'), name, denylist),
    );
  }
  return findings;
}

/** The commits a push sends, from the pre-push hook's stdin lines. */
export function prePushRevs(stdin) {
  const zero = /^0+$/;
  const revs = [];
  for (const line of stdin.split(/\r?\n/).filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(' ');
    if (!localSha || zero.test(localSha)) continue;
    revs.push(localSha);
    if (remoteSha && !zero.test(remoteSha)) revs.push(`^${remoteSha}`);
  }
  return revs;
}

/**
 * The command line, run against the repository at root. Returns the exit code: 0 clean, 1 with
 * findings, 2 for an unknown mode. stdin supplies the pre-push hook's lines.
 */
export function main(args, { root, env = process.env, stdin = () => readFileSync(0, 'utf8'), log = console.log, error = console.error }) {
  const denylist = readDenylist(env.OMB_DENYLIST ?? join(root, 'local', 'denylist.txt'));
  const [mode = '--staged', ...rest] = args;
  let findings;
  if (mode === '--staged') findings = checkStaged(root, denylist);
  else if (mode === '--history') findings = checkHistory(root, rest.length > 0 ? rest : ['--all'], denylist);
  else if (mode === '--pre-push') {
    const revs = prePushRevs(stdin());
    findings = revs.length > 0 ? checkHistory(root, revs, denylist) : [];
  } else {
    error(`Unknown mode ${mode}: use --staged, --pre-push or --history [revs]`);
    return 2;
  }
  if (denylist.length === 0) log('check-private: no local/denylist.txt, nothing checked');
  if (findings.length === 0) return 0;
  error(`check-private: ${findings.length} finding(s) from local/denylist.txt`);
  for (const f of findings) error(`  ${f}`);
  return 1;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  process.exitCode = main(process.argv.slice(2), { root: resolve(dirname(self), '..') });
}
