import type { Plugin } from 'vite'

/** Repo-relative paths (forward slashes, sorted) of the files a fresh setup gets: config.json, ahk/, powershell/ and img/, minus tests, local and leftovers. */
export function listStarterFiles(repoRoot: string): string[]

/** A Vite plugin serving the virtual module `virtual:omb-starter`: those files as { path, base64 }. */
export function starterPlugin(repoRoot: string): Plugin
