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

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Problems in a parsed config, as readable strings (empty when valid).
 * @param {object} config parsed config.json
 * @param {{ iconExists?: (name: string) => boolean, ahkActions?: Set<string>|null, psActions?: Set<string>|null }} checks
 *   iconExists: is there an img/<name> icon set; ahkActions / psActions: lower-cased command names
 *   defined in each version (null skips that check)
 */
export function validateConfig(config, { iconExists = () => true, ahkActions = null, psActions = null } = {}) {
  if (!isObject(config)) return ['config: must be a JSON object'];
  // Each check adds to errors; actions collects [action, where] pairs to look up at the end.
  const ctx = { iconExists, errors: [], actions: [] };

  checkKey(config.fn, 'fn', ctx);
  const keys = listOf(config.keys);
  if (keys.length === 0) ctx.errors.push('keys: must be a non-empty list');
  keys.forEach((k, i) => checkKey(k, `keys[${i}]`, ctx));
  checkLayers(config.layers ?? [], keys.length, ctx);

  if (config.default !== undefined && !(Number.isInteger(config.default) && config.default >= 1)) {
    ctx.errors.push('default: must be a whole number from 1');
  }
  if (config.iconAction !== undefined && !['Layer', 'Macro'].includes(config.iconAction)) {
    ctx.errors.push('iconAction: must be "Layer" or "Macro"');
  }
  listOf(config.hotkeys).forEach((h, i) => checkHotkey(h, i, ctx));
  listOf(config.hotstrings).forEach((s, i) => checkHotstring(s, i, ctx));

  for (const [action, where] of ctx.actions) {
    const name = action.toLowerCase();
    if (ahkActions && !ahkActions.has(name)) ctx.errors.push(`${where}: action "${action}" is not defined in ahk/commands`);
    if (psActions && !psActions.has(name)) ctx.errors.push(`${where}: action "${action}" is not defined in powershell/commands`);
  }
  return ctx.errors;
}

const listOf = (v) => (Array.isArray(v) ? v : []);

/** One key definition: the Fn key or a macro key. */
function checkKey(k, where, { errors }) {
  if (!isObject(k) || typeof k.key !== 'string' || k.key === '') {
    errors.push(`${where}: needs a "key" name`);
    return;
  }
  for (const field of ['row', 'col', 'width', 'height']) {
    if (k[field] !== undefined && !(Number.isInteger(k[field]) && k[field] >= 1)) {
      errors.push(`${where}: "${field}" must be a whole number from 1`);
    }
  }
}

/** The layers list: no more layers in use than keys, and each layer valid. */
function checkLayers(layers, keyCount, ctx) {
  if (!Array.isArray(layers)) {
    ctx.errors.push('layers: must be a list');
    return;
  }
  const used = layers.filter((l) => !(isObject(l) && l.disabled === true));
  if (used.length > keyCount) ctx.errors.push(`layers: ${used.length} layers for ${keyCount} keys`);
  layers.forEach((layer, i) => checkLayer(layer, `layers[${i}]`, keyCount, ctx));
}

/** One layer (null is an empty slot): title, icon and its macros. */
function checkLayer(layer, where, keyCount, ctx) {
  if (layer === null) return;
  const { errors, iconExists } = ctx;
  if (!isObject(layer)) {
    errors.push(`${where}: must be an object or null`);
    return;
  }
  if (typeof layer.title !== 'string') errors.push(`${where}: needs a "title"`);
  if (typeof layer.icon !== 'string' || layer.icon === '') errors.push(`${where}: needs an "icon"`);
  else if (!iconExists(layer.icon)) errors.push(`${where}: icon folder "${layer.icon}" not found in img/`);
  const macros = layer.macros ?? [];
  if (!Array.isArray(macros)) {
    errors.push(`${where}.macros: must be a list`);
    return;
  }
  if (macros.length > keyCount) errors.push(`${where}.macros: ${macros.length} macros for ${keyCount} keys`);
  macros.forEach((macro, j) => checkMacro(macro, `${where}.macros[${j}]`, layer.disabled === true, ctx));
}

/** One macro slot (null is empty). A disabled layer is never loaded, so its actions need not exist. */
function checkMacro(macro, where, layerDisabled, { errors, actions, iconExists }) {
  if (macro === null) return;
  if (!isObject(macro) || typeof macro.action !== 'string' || typeof macro.name !== 'string') {
    errors.push(`${where}: needs "action" and "name"`);
    return;
  }
  if (macro.icon !== undefined && macro.icon !== '' && !iconExists(macro.icon)) {
    errors.push(`${where}: icon folder "${macro.icon}" not found in img/`);
  }
  if (!layerDisabled) actions.push([macro.action, where]);
}

function checkHotkey(h, i, { errors, actions }) {
  if (h === null) return;
  if (!isObject(h) || typeof h.hotkey !== 'string' || typeof h.action !== 'string') {
    errors.push(`hotkeys[${i}]: needs "hotkey" and "action"`);
    return;
  }
  actions.push([h.action, `hotkeys[${i}]`]);
}

/** One hotstring: an action needs the X option and the X option needs an action. */
function checkHotstring(s, i, { errors, actions }) {
  if (s === null) return;
  const where = `hotstrings[${i}]`;
  if (!isObject(s) || typeof s.hotstring !== 'string' || !/^:[^:]*:./.test(s.hotstring)) {
    errors.push(`${where}: needs a "hotstring" such as "::btw"`);
    return;
  }
  const options = s.hotstring.match(/^:([^:]*):/)[1];
  const execute = /X(?!0)/i.test(options);
  const hasAction = typeof s.action === 'string' && s.action !== '';
  if (hasAction && !execute) errors.push(`${where}: '${s.hotstring}' has an action but no X option`);
  else if (execute && !hasAction) errors.push(`${where}: '${s.hotstring}' has the X option but no action`);
  else if (execute) actions.push([s.action, where]);
  else if (typeof s.replacement !== 'string') errors.push(`${where}: needs a "replacement"`);
}

const AHK_FUNCTION = /^(\w+)\s*\(/gm;
const PS_FUNCTION = /^[ \t]*function[ \t]+([\w-]+)/gim;

/** Lower-cased names of the functions defined in every <ext> file under dir. */
export function commandNames(dir, ext) {
  const names = new Set();
  const pattern = ext === '.ahk' ? AHK_FUNCTION : PS_FUNCTION;
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (extname(path).toLowerCase() === ext) {
        for (const m of readFileSync(path, 'utf8').matchAll(pattern)) names.add(m[1].toLowerCase());
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
