// node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decide, tag, notes, checksums, github, main } from './ci-release.mjs';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

/**
 * A stand-in for git. `refs` maps a ref to its commit; a ref that is missing fails, as
 * `rev-parse --verify` does. Every call is recorded in `calls`, joined by spaces.
 */
function fakeGit({ refs = { HEAD }, previous = null, commits = '- fix: one\n- feat: two\n', body = '' } = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse') {
      const ref = args.at(-1).replace('^{commit}', '');
      if (!(ref in refs)) throw new Error('no such ref');
      return `${refs[ref]}\n`;
    }
    if (args[0] === 'describe') {
      if (previous === null) throw new Error('No names found');
      return `${previous}\n`;
    }
    if (args[0] === 'log') return commits;
    if (args[0] === 'tag' && args[1] === '-l') return body;
    return '';
  };
  return { git, calls };
}

test('only develop releases', () => {
  assert.deepEqual(decide('develop'), { release: true });
  assert.equal(decide('release-prep').release, false);
  assert.match(decide('release-prep').reason, /'release-prep' is not develop/);
  assert.match(decide(undefined).reason, /'' is not develop/);
});

test('the first release is tagged with every commit and pushed', () => {
  const { git, calls } = fakeGit();
  const log = [];
  assert.equal(tag({ env: { VERSION: '1.0.0' }, git, log: (line) => log.push(line) }), 0);
  assert.ok(calls.includes('log --no-merges --format=- %s HEAD'));
  const made = calls.find((call) => call.includes('tag -a v1.0.0'));
  assert.match(made, /-m Open Macro Builder v1\.0\.0\n\n- fix: one\n- feat: two$/);
  assert.equal(calls.at(-1), 'push origin refs/tags/v1.0.0');
  assert.deepEqual(log, ['tagged v1.0.0']);
});

test('a later release lists the commits since the tag before it', () => {
  const { git, calls } = fakeGit({ previous: 'v1.0.3' });
  assert.equal(tag({ env: { VERSION: '1.0.4' }, git, log: () => {} }), 0);
  assert.ok(calls.includes('log --no-merges --format=- %s v1.0.3..HEAD'));
});

test('a tag already on HEAD is a rebuild: not made again, but pushed again', () => {
  const { git, calls } = fakeGit({ refs: { HEAD, 'refs/tags/v1.0.4': HEAD } });
  const log = [];
  assert.equal(tag({ env: { VERSION: '1.0.4' }, git, log: (line) => log.push(line) }), 0);
  assert.equal(calls.some((call) => call.includes('tag -a')), false);
  assert.equal(calls.at(-1), 'push origin refs/tags/v1.0.4');
  assert.match(log[0], /a rebuild of the release/);
});

test('a tag on another commit stops the release and pushes nothing', () => {
  const { git, calls } = fakeGit({ refs: { HEAD, 'refs/tags/v1.0.4': OTHER } });
  const log = [];
  assert.equal(tag({ env: { VERSION: '1.0.4' }, git, log: (line) => log.push(line) }), 4);
  assert.equal(calls.some((call) => call.startsWith('push')), false);
  assert.deepEqual(log, ['tag v1.0.4 already exists on another commit']);
});

test('tagging needs a three-number VERSION', () => {
  const { git, calls } = fakeGit();
  assert.equal(tag({ env: { VERSION: 'latest' }, git, log: () => {} }), 2);
  assert.equal(tag({ env: {}, git, log: () => {} }), 2);
  assert.deepEqual(calls, []);
});

test('the notes name the image and list the changes, and leave out what is missing', () => {
  const full = notes({ version: '1.0.2', image: 'ghcr.io/x/y', commits: '- fix: one' });
  assert.equal(full, 'Container image: `docker run --rm -p 8080:8080 ghcr.io/x/y:1.0.2`\n\n## Changes\n\n- fix: one');
  assert.equal(notes({ version: '1.0.2', image: undefined, commits: '- fix: one' }), '## Changes\n\n- fix: one');
  assert.equal(notes({ version: '1.0.2', image: undefined, commits: '' }), '');
});

test('the checksum file has one sha256 line per file', () => {
  const sum = (text) => createHash('sha256').update(text).digest('hex');
  const text = checksums([
    { name: 'a.exe', bytes: Buffer.from('one') },
    { name: 'b.exe', bytes: Buffer.from('two') },
  ]);
  assert.equal(text, `${sum('one')}  a.exe\n${sum('two')}  b.exe\n`);
});

/**
 * A stand-in for GitHub. `existing` is the release the tag already has, or null. Every request is
 * recorded as { method, url, headers, body }.
 */
function fakeGitHub({ existing = null, failOn = null } = {}) {
  const requests = [];
  const answer = (status, value) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(value),
    text: () => Promise.resolve(JSON.stringify(value)),
  });
  const fetch = (url, { method, headers, body }) => {
    requests.push({ method, url, headers, body });
    if (failOn !== null && url.includes(failOn)) return Promise.resolve(answer(500, { message: 'boom' }));
    if (method === 'GET') return Promise.resolve(existing === null ? answer(404, {}) : answer(200, existing));
    if (method === 'DELETE') return Promise.resolve(answer(204, null));
    if (url.startsWith('https://api.github.com')) return Promise.resolve(answer(201, { id: 7, html_url: 'https://example.test/r/7' }));
    return Promise.resolve(answer(201, {}));
  };
  return { fetch, requests };
}

const env = { VERSION: '1.0.2', GITHUB_TOKEN: 't0ken', IMAGE: 'ghcr.io/x/y' };
const readFile = (path) => Buffer.from(`bytes of ${path}`);

// Runs github() and returns { code, log, requests, calls }.
async function publish({ paths = ['out/Setup.exe', 'out/portable.exe'], hub = fakeGitHub(), environment = env } = {}) {
  const { git, calls } = fakeGit({ body: '- fix: one\n' });
  const log = [];
  const code = await github({ env: environment, paths, git, fetch: hub.fetch, readFile, log: (line) => log.push(line) });
  return { code, log, requests: hub.requests, calls };
}

test('a new release is created from the tag, then each file and the checksums are attached', async () => {
  const { code, log, requests } = await publish();
  assert.equal(code, 0);

  const [find, create, ...uploads] = requests;
  assert.equal(`${find.method} ${find.url}`, 'GET https://api.github.com/repos/hotdog-Studio/Open-Macro-Builder/releases/tags/v1.0.2');
  assert.equal(`${create.method} ${create.url}`, 'POST https://api.github.com/repos/hotdog-Studio/Open-Macro-Builder/releases');
  assert.deepEqual(JSON.parse(create.body), {
    tag_name: 'v1.0.2',
    name: 'Open Macro Builder 1.0.2',
    body: 'Container image: `docker run --rm -p 8080:8080 ghcr.io/x/y:1.0.2`\n\n## Changes\n\n- fix: one',
  });

  const base = 'https://uploads.github.com/repos/hotdog-Studio/Open-Macro-Builder/releases/7/assets?name=';
  assert.deepEqual(uploads.map((r) => `${r.method} ${r.url}`).sort(), [
    `POST ${base}SHA256SUMS.txt`,
    `POST ${base}Setup.exe`,
    `POST ${base}portable.exe`,
  ]);
  const setup = uploads.find((r) => r.url.endsWith('Setup.exe'));
  assert.equal(setup.body.toString(), 'bytes of out/Setup.exe');
  assert.equal(setup.headers['Content-Type'], 'application/octet-stream');
  const sums = uploads.find((r) => r.url.endsWith('SHA256SUMS.txt')).body.toString();
  assert.match(sums, /^[0-9a-f]{64} {2}Setup\.exe\n[0-9a-f]{64} {2}portable\.exe\n$/);

  assert.equal(log[0], 'created the release v1.0.2');
  assert.equal(log.at(-1), 'https://example.test/r/7');
});

test('every request carries the token, and the token is never logged', async () => {
  const { log, requests } = await publish();
  for (const request of requests) assert.equal(request.headers.Authorization, 'Bearer t0ken');
  assert.equal(log.join('\n').includes('t0ken'), false);
});

test('a release that exists is reused, and a file it already has is replaced', async () => {
  const existing = { id: 9, html_url: 'https://example.test/r/9', assets: [{ id: 41, name: 'Setup.exe' }] };
  const { code, log, requests, calls } = await publish({ hub: fakeGitHub({ existing }) });
  assert.equal(code, 0);
  assert.equal(requests.some((r) => r.method === 'POST' && r.url.endsWith('/releases')), false);
  assert.deepEqual(calls, []);
  const removed = requests.filter((r) => r.method === 'DELETE').map((r) => r.url);
  assert.deepEqual(removed, ['https://api.github.com/repos/hotdog-Studio/Open-Macro-Builder/releases/assets/41']);
  assert.equal(requests.filter((r) => r.url.startsWith('https://uploads.github.com/repos/hotdog-Studio/Open-Macro-Builder/releases/9/')).length, 3);
  assert.equal(log[0], 'the release v1.0.2 exists: its files are replaced');
});

test('a file name with spaces is found under the dotted name GitHub gave it', async () => {
  const existing = { id: 9, html_url: 'u', assets: [{ id: 5, name: 'Open.Macro.Builder.exe' }] };
  const { requests } = await publish({ paths: ['out/Open Macro Builder.exe'], hub: fakeGitHub({ existing }) });
  assert.equal(requests.filter((r) => r.method === 'DELETE').length, 1);
  assert.ok(requests.some((r) => r.url.endsWith('?name=Open%20Macro%20Builder.exe')));
});

test('GITHUB_REPOSITORY overrides the repository', async () => {
  const { requests } = await publish({ environment: { ...env, GITHUB_REPOSITORY: 'someone/fork' } });
  assert.equal(requests[0].url, 'https://api.github.com/repos/someone/fork/releases/tags/v1.0.2');
});

test('an error from GitHub fails with the status and without the query string', async () => {
  await assert.rejects(publish({ hub: fakeGitHub({ failOn: 'uploads.github.com' }) }), (problem) => {
    assert.match(problem.message, /answered 500/);
    assert.equal(problem.message.includes('?name='), false);
    return true;
  });
});

test('publishing needs a version, a token and a file', async () => {
  assert.equal((await publish({ paths: [] })).code, 2);
  assert.equal((await publish({ environment: { VERSION: '1.0.2' } })).code, 2);
  const { code, requests } = await publish({ environment: { GITHUB_TOKEN: 't0ken' } });
  assert.equal(code, 2);
  assert.deepEqual(requests, []);
});

// Runs main() and returns { code, log }.
async function run(argv, environment) {
  const { git } = fakeGit();
  const log = [];
  const code = await main(argv, { env: environment, git, fetch: fakeGitHub().fetch, readFile, log: (line) => log.push(line) });
  return { code, log };
}

test('--check exits 0 on develop and 3 with the reason elsewhere', async () => {
  assert.deepEqual(await run(['--check'], { BRANCH_NAME: 'develop' }), { code: 0, log: [] });
  const other = await run(['--check'], { BRANCH_NAME: 'feature/x' });
  assert.equal(other.code, 3);
  assert.match(other.log[0], /^no release: 'feature\/x' is not develop/);
});

test('the command line reaches tag and github', async () => {
  assert.equal((await run(['tag'], { VERSION: '1.0.0' })).code, 0);
  assert.equal((await run(['github', 'a.exe'], env)).code, 0);
});

test('anything else is a usage error', async () => {
  for (const argv of [[], ['--check', 'x'], ['tag', 'x'], ['publish']]) {
    const result = await run(argv, {});
    assert.equal(result.code, 2);
    assert.match(result.log[0], /^usage/);
  }
});
