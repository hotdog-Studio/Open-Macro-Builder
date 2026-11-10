#!/usr/bin/env node
// Validates config.json, the layout both the AutoHotkey (ahk/) and PowerShell (powershell/)
// versions read, without needing Windows: its structure, slot counts, icon folders, and that
// every action is a command defined in BOTH versions. Jenkins runs it on the Linux agent.
//
// Usage: node scripts/validate-config.mjs [path/to/config.json]
// Without a path it checks the file both versions would load: OMB_CONFIG, else local/config.json
// (your own layout, ignored by git) when it exists, else the example config.json. Commands in
// local/ahk and local/powershell/commands count as defined.
// Exit 0 when the config is valid; 1 with one line per problem otherwise.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, functionNames } from './validate-config-core.mjs';

export { validateConfig };

/** Lower-cased names of the functions defined in every <ext> file under dir. */
export function commandNames(dir, ext) {
  const names = new Set();
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (extname(path).toLowerCase() === ext) {
        for (const name of functionNames(readFileSync(path, 'utf8'), ext)) names.add(name);
      }
    }
  };
  walk(dir);
  return names;
}

/** Command names in each folder that exists, merged. */
function namesIn(dirs, ext) {
  const names = new Set();
  for (const dir of dirs) {
    if (existsSync(dir)) for (const n of commandNames(dir, ext)) names.add(n);
  }
  return names;
}

/**
 * The checks against this repository: img/ icon sets and both versions' command folders, plus
 * your own commands in local/ when that folder exists.
 */
export function repoChecks(root) {
  return {
    iconExists: (name) => existsSync(join(root, 'img', name, 'layer.png')),
    ahkActions: namesIn([join(root, 'ahk', 'commands'), join(root, 'local', 'ahk')], '.ahk'),
    psActions: namesIn([join(root, 'powershell', 'commands'), join(root, 'local', 'powershell', 'commands')], '.ps1'),
  };
}

/** The config both versions load: OMB_CONFIG, else local/config.json when it exists, else config.json. */
export function activeConfigPath(root, env = process.env) {
  if (env.OMB_CONFIG) return env.OMB_CONFIG;
  const local = join(root, 'local', 'config.json');
  return existsSync(local) ? local : join(root, 'config.json');
}

/**
 * The command line: validates args[0], or the active config, against the repository at root.
 * Returns the exit code; report lines go to log (success) and error (problems).
 */
export function main(args, { root, env = process.env, log = console.log, error = console.error }) {
  const file = resolve(args[0] ?? activeConfigPath(root, env));
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    error(`Invalid JSON in ${file}: ${e.message}`);
    return 1;
  }
  const errors = validateConfig(config, repoChecks(root));
  if (errors.length > 0) {
    error(`${file}: ${errors.length} problem(s)`);
    for (const e of errors) error(`  ${e}`);
    return 1;
  }
  const layers = (config.layers ?? []).filter((l) => l !== null && l.disabled !== true).length;
  log(`${file}: OK (${config.keys.length} keys, ${layers} layers, every action defined in both versions)`);
  return 0;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  process.exitCode = main(process.argv.slice(2), { root: resolve(dirname(self), '..') });
}
