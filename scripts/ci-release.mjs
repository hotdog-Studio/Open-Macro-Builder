#!/usr/bin/env node
// The Jenkins Release stage's decision and its git and GitHub steps (docs/releasing.md).
//
//   node scripts/ci-release.mjs --check          exit 0 when BRANCH_NAME releases, 3 with the reason when not
//   node scripts/ci-release.mjs tag              make the tag v<VERSION> on HEAD and push it
//   node scripts/ci-release.mjs github <file>…   publish the GitHub release of v<VERSION> with these files
//
// From the environment: BRANCH_NAME (the branch Jenkins builds), VERSION (what scripts/ci-version.mjs
// printed) and, for `github`, GITHUB_TOKEN (may write the repository's contents), GITHUB_REPOSITORY
// (owner/name, defaults to this project's) and IMAGE (the container image, named in the notes).
//
// Only develop releases. The tag is pushed first and everything else is published under it
// afterwards, so a number is taken only once its tag exists: a later failure leaves a gap, never
// two builds with one number. Every step can be run again: a tag already on HEAD is pushed again,
// the release is found by its tag, and a file already attached is replaced.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const RELEASE_BRANCH = 'develop';
const DEFAULT_REPOSITORY = 'hotdog-Studio/Open-Macro-Builder';
const VERSION = /^\d+\.\d+\.\d+$/;
const EXIT_USAGE = 2;
const EXIT_SKIPPED = 3;
const EXIT_TAG_ELSEWHERE = 4;

/** Does a green build of this branch release? `{ release: true }` or `{ release: false, reason }`. */
export function decide(branch) {
  if (branch === RELEASE_BRANCH) return { release: true };
  return { release: false, reason: `'${branch ?? ''}' is not ${RELEASE_BRANCH}, the only branch that releases` };
}

// The commit a ref names, or null when there is no such ref.
function commitOf(ref, git) {
  try {
    return git(['rev-parse', '-q', '--verify', `${ref}^{commit}`]).trim();
  } catch {
    return null;
  }
}

// The newest version tag before HEAD, or null for the first release.
function previousTag(git) {
  try {
    return git(['describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0']).trim();
  } catch {
    return null;
  }
}

/** Makes the annotated tag v<VERSION> on HEAD, listing the commits it carries, and pushes it. */
export function tag({ env, git, log }) {
  if (!VERSION.test(env.VERSION ?? '')) {
    log(`ci-release: VERSION is not MAJOR.MINOR.PATCH: '${env.VERSION ?? ''}'`);
    return EXIT_USAGE;
  }
  const name = `v${env.VERSION}`;
  const existing = commitOf(`refs/tags/${name}`, git);
  if (existing !== null && existing !== commitOf('HEAD', git)) {
    log(`tag ${name} already exists on another commit`);
    return EXIT_TAG_ELSEWHERE;
  }
  if (existing === null) {
    const base = previousTag(git);
    const commits = git(['log', '--no-merges', '--format=- %s', base === null ? 'HEAD' : `${base}..HEAD`]).trim();
    const message = `Open Macro Builder ${name}\n\n${commits}`;
    git(['-c', 'user.name=Jenkins', '-c', 'user.email=jenkins@localhost', 'tag', '-a', name, '-m', message]);
    log(`tagged ${name}`);
  } else {
    log(`tag ${name} is already on this commit: a rebuild of the release`);
  }
  git(['push', 'origin', `refs/tags/${name}`]);
  return 0;
}

/** The text of the GitHub release: where to get the image, then the commits the tag lists. */
export function notes({ version, image, commits }) {
  const parts = [];
  if (image) parts.push(`Container image: \`docker run --rm -p 8080:8080 ${image}:${version}\``);
  if (commits) parts.push(`## Changes\n\n${commits}`);
  return parts.join('\n\n');
}

/** The lines of SHA256SUMS.txt for these files: `<sha256>  <name>`. */
export function checksums(files) {
  return files.map(({ name, bytes }) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`).join('');
}

// One call of GitHub's REST API. Returns the parsed answer, or null for a status in `allow`.
async function call(fetch, token, url, { method = 'GET', body, type, allow = [] } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'open-macro-builder-ci',
  };
  if (type) headers['Content-Type'] = type;
  const answer = await fetch(url, { method, headers, body });
  if (allow.includes(answer.status)) return null;
  if (!answer.ok) throw new Error(`GitHub ${method} ${url.split('?')[0]} answered ${answer.status}: ${await answer.text()}`);
  return answer.status === 204 ? null : answer.json();
}

/** Publishes the GitHub release of v<VERSION> with `paths` attached, and a SHA256SUMS.txt of them. */
export async function github({ env, paths, git, fetch, readFile, log }) {
  const { VERSION: version, GITHUB_TOKEN: token } = env;
  if (!VERSION.test(version ?? '') || !token || paths.length === 0) {
    log('ci-release: github needs VERSION, GITHUB_TOKEN and at least one file');
    return EXIT_USAGE;
  }
  const repository = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const api = `https://api.github.com/repos/${repository}`;
  const name = `v${version}`;
  const send = (url, options) => call(fetch, token, url, options);

  let release = await send(`${api}/releases/tags/${name}`, { allow: [404] });
  if (release === null) {
    const commits = git(['tag', '-l', '--format=%(contents:body)', name]).trim();
    const body = JSON.stringify({
      tag_name: name,
      name: `Open Macro Builder ${version}`,
      body: notes({ version, image: env.IMAGE, commits }),
    });
    release = await send(`${api}/releases`, { method: 'POST', body, type: 'application/json' });
    log(`created the release ${name}`);
  } else {
    log(`the release ${name} exists: its files are replaced`);
  }

  const files = paths.map((path) => ({ name: basename(path), bytes: readFile(path) }));
  files.push({ name: 'SHA256SUMS.txt', bytes: Buffer.from(checksums(files)) });
  const attached = new Map((release.assets ?? []).map((asset) => [asset.name, asset.id]));
  const upload = `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets`;
  await Promise.all(
    files.map(async (file) => {
      // GitHub stores a space in a file name as a dot, so look for the name it would have given.
      const old = attached.get(file.name) ?? attached.get(file.name.replaceAll(' ', '.'));
      if (old !== undefined) await send(`${api}/releases/assets/${old}`, { method: 'DELETE' });
      const url = `${upload}?name=${encodeURIComponent(file.name)}`;
      await send(url, { method: 'POST', body: file.bytes, type: 'application/octet-stream' });
      log(`attached ${file.name}`);
    }),
  );
  log(release.html_url);
  return 0;
}

/** Runs the command line and returns the exit code. */
export async function main(argv, { env, git, fetch, readFile, log }) {
  const [command, ...rest] = argv;
  if (command === '--check' && rest.length === 0) {
    const decision = decide(env.BRANCH_NAME);
    if (decision.release) return 0;
    log(`no release: ${decision.reason}`);
    return EXIT_SKIPPED;
  }
  if (command === 'tag' && rest.length === 0) return tag({ env, git, log });
  if (command === 'github') return github({ env, paths: rest, git, fetch, readFile, log });
  log('usage: node scripts/ci-release.mjs --check | tag | github <file>…');
  return EXIT_USAGE;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The git on PATH, as in scripts/check-private.mjs. It runs in the workspace Jenkins checked out.
  const git = (args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const deps = { env: process.env, git, fetch, readFile: (path) => readFileSync(path), log: (line) => console.log(line) };
  try {
    process.exitCode = await main(process.argv.slice(2), deps);
  } catch (problem) {
    console.error(problem.message);
    process.exitCode = 1;
  }
}
