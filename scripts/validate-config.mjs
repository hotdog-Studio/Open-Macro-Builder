#!/usr/bin/env node
// Validates config.json, the layout both the AutoHotkey (ahk/) and PowerShell (powershell/)
// versions read, without needing Windows: its structure, slot counts, icon folders, and that
// every action is a command defined in BOTH versions. Jenkins runs it on the Linux agent.
//
// Usage: node scripts/validate-config.mjs [path/to/config.json]
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
  const errors = [];
  const actions = [];

  const checkKey = (k, where) => {
    if (!isObject(k) || typeof k.key !== 'string' || k.key === '') {
      errors.push(`${where}: needs a "key" name`);
      return;
    }
    for (const field of ['row', 'col', 'width', 'height']) {
      if (k[field] !== undefined && !(Number.isInteger(k[field]) && k[field] >= 1)) {
        errors.push(`${where}: "${field}" must be a whole number from 1`);
      }
    }
  };

  checkKey(config.fn, 'fn');
  const keys = Array.isArray(config.keys) ? config.keys : [];
  if (keys.length === 0) errors.push('keys: must be a non-empty list');
  keys.forEach((k, i) => checkKey(k, `keys[${i}]`));

  const layers = config.layers ?? [];
  if (!Array.isArray(layers)) {
    errors.push('layers: must be a list');
  } else {
    const used = layers.filter((l) => !(isObject(l) && l.disabled === true));
    if (used.length > keys.length) errors.push(`layers: ${used.length} layers for ${keys.length} keys`);
    layers.forEach((layer, i) => {
      if (layer === null) return;
      const where = `layers[${i}]`;
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
      if (macros.length > keys.length) errors.push(`${where}.macros: ${macros.length} macros for ${keys.length} keys`);
      macros.forEach((macro, j) => {
        if (macro === null) return;
        const mw = `${where}.macros[${j}]`;
        if (!isObject(macro) || typeof macro.action !== 'string' || typeof macro.name !== 'string') {
          errors.push(`${mw}: needs "action" and "name"`);
          return;
        }
        if (macro.icon !== undefined && macro.icon !== '' && !iconExists(macro.icon)) {
          errors.push(`${mw}: icon folder "${macro.icon}" not found in img/`);
        }
        // A disabled layer is never loaded, so its actions need not exist.
        if (layer.disabled !== true) actions.push([macro.action, mw]);
      });
    });
  }

  if (config.default !== undefined && !(Number.isInteger(config.default) && config.default >= 1)) {
    errors.push('default: must be a whole number from 1');
  }
  if (config.iconAction !== undefined && !['Layer', 'Macro'].includes(config.iconAction)) {
    errors.push('iconAction: must be "Layer" or "Macro"');
  }

  (Array.isArray(config.hotkeys) ? config.hotkeys : []).forEach((h, i) => {
    if (h === null) return;
    if (!isObject(h) || typeof h.hotkey !== 'string' || typeof h.action !== 'string') {
      errors.push(`hotkeys[${i}]: needs "hotkey" and "action"`);
      return;
    }
    actions.push([h.action, `hotkeys[${i}]`]);
  });

  (Array.isArray(config.hotstrings) ? config.hotstrings : []).forEach((s, i) => {
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
  });

  for (const [action, where] of actions) {
    const name = action.toLowerCase();
    if (ahkActions && !ahkActions.has(name)) errors.push(`${where}: action "${action}" is not defined in ahk/commands`);
    if (psActions && !psActions.has(name)) errors.push(`${where}: action "${action}" is not defined in powershell/commands`);
  }
  return errors;
}

const AHK_FUNCTION = /^(\w+)\s*\(/gm;
const PS_FUNCTION = /^\s*function\s+([\w-]+)/gim;

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

/** The checks against this repository: img/ icon sets and both versions' command folders. */
export function repoChecks(root) {
  return {
    iconExists: (name) => existsSync(join(root, 'img', name, 'layer.png')),
    ahkActions: commandNames(join(root, 'ahk', 'commands'), '.ahk'),
    psActions: commandNames(join(root, 'powershell', 'commands'), '.ps1'),
  };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const root = resolve(dirname(self), '..');
  const file = resolve(process.argv[2] ?? join(root, 'config.json'));
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    console.error(`Invalid JSON in ${file}: ${e.message}`);
    process.exit(1);
  }
  const errors = validateConfig(config, repoChecks(root));
  if (errors.length > 0) {
    console.error(`${file}: ${errors.length} problem(s)`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  const layers = (config.layers ?? []).filter((l) => l !== null && l.disabled !== true).length;
  console.log(`${file}: OK (${config.keys.length} keys, ${layers} layers, every action defined in both versions)`);
}
