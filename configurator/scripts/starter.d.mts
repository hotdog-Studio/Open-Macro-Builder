import type { Plugin } from 'vite'

/** Repo-relative paths (forward slashes, sorted) of the files a fresh setup gets: config.json, ahk/, powershell/ and img/, minus tests, local and leftovers. */
export function listStarterFiles(repoRoot: string): string[]

/** The version a build carries: its `APP_VERSION` (empty or blank counts as none), else `<MAJOR.MINOR>.0-dev` from the package version. */
export function starterVersion(env: Record<string, string | undefined>, packageVersion: string): string

/** The starter's version and the fingerprint of each of its files, made with node:crypto from the canonical bytes. */
export function starterIndex(repoRoot: string, version: string): { version: string; files: Record<string, string> }

/**
 * A Vite plugin serving the virtual module `virtual:omb-starter` (those files as { path, base64 }) and
 * `virtual:omb-starter-index` (their version and fingerprints). The options default to process.env and
 * the version in configurator/package.json.
 */
export function starterPlugin(repoRoot: string, options?: { env?: Record<string, string | undefined>; packageVersion?: string }): Plugin
