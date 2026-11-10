// node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDenylist, findIn, checkHistory, checkStaged, prePushRevs } from './check-private.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd }).toString().trim();

// A throwaway repository with one commit holding `files`.
function repo(files, message = 'init') {
  const dir = mkdtempSync(join(tmpdir(), 'omb-private-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return dir;
}

test('reads a deny-list, skipping blanks and comments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omb-deny-'));
  try {
    writeFileSync(join(dir, 'd.txt'), '# hosts\nMyServer\n\n  secret-host  \n');
    assert.deepEqual(readDenylist(join(dir, 'd.txt')), ['myserver', 'secret-host']);
    assert.deepEqual(readDenylist(join(dir, 'missing.txt')), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('finds deny-listed strings in text, ignoring case, and skips binary', () => {
  assert.deepEqual(findIn('ok\nssh MyServer\n', 'a.txt', ['myserver']), ['a.txt: line 2 contains "myserver"']);
  assert.deepEqual(findIn('my\0server', 'b.bin', ['myserver']), []);
});

test('checks every file, path and message in history', () => {
  const dir = repo({ 'a.txt': 'clean\n' });
  try {
    writeFileSync(join(dir, 'a.txt'), 'ssh secret-host\n');
    git(dir, 'commit', '-q', '-am', 'mention secret-host');
    writeFileSync(join(dir, 'a.txt'), 'clean again\n');
    git(dir, 'commit', '-q', '-am', 'tidy');
    const findings = checkHistory(dir, ['HEAD'], ['secret-host']);
    assert.ok(findings.some((f) => f.startsWith('a.txt (') && f.endsWith('line 1 contains "secret-host"')), findings.join('\n'));
    assert.ok(findings.some((f) => f.includes('message: line 1')), findings.join('\n'));
    assert.deepEqual(checkHistory(dir, ['HEAD'], ['nothing-here']), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('checks staged files only', () => {
  const dir = repo({ 'a.txt': 'clean\n' });
  try {
    writeFileSync(join(dir, 'b.txt'), 'secret-host\n');
    assert.deepEqual(checkStaged(dir, ['secret-host']), []);
    git(dir, 'add', 'b.txt');
    assert.deepEqual(checkStaged(dir, ['secret-host']), ['b.txt: line 1 contains "secret-host"']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('turns pre-push lines into the commits being sent', () => {
  const zero = '0'.repeat(40);
  assert.deepEqual(prePushRevs(`refs/heads/a 111 refs/heads/a 222\nrefs/heads/b 333 refs/heads/b ${zero}\nrefs/heads/c ${zero} refs/heads/c 444\n`),
    ['111', '^222', '333']);
});
