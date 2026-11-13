#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawl } from './lib/crawler.mjs';
import { judge } from './lib/judge.mjs';
import { makeProvider } from './providers/index.mjs';
import {
  readJson,
  writeJson,
  skipped,
  inside,
  canonicalExisting
} from './lib/common.mjs';
import { render } from './lib/report.mjs';
import {
  canonicalOutput,
  initializeOutput,
  invalidatePrior
} from './lib/output.mjs';
function parse(args) {
  const opt = {
    out: 'out',
    ai: false,
    allowRemote: false
  };
  const used = new Set();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ([
        '--out',
        '--config'
      ].includes(a)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) {
        opt.error = 'Option needs a value';
        if (a === '--out')
          opt.outInvalid = true;
        continue;
      }
      const value = args[++i];
      if (used.has(a)) {
        opt.error = 'Duplicate options are not supported';
        if (a === '--out')
          opt.outInvalid = true;
        continue;
      }
      used.add(a);
      opt[a === '--out' ? 'out' : 'configPath'] = value;
    } else if (a === '--ai')
      opt.ai = true;
    else if (a === '--allow-remote')
      opt.allowRemote = true;
    else if (a === '--wiring-only')
      opt.wiring = true;
    else if (a.startsWith('--') || opt.root)
      opt.error = 'Unexpected argument; use --help';
    else
      opt.root = a;
  }
  if (!opt.root)
    opt.error = 'A web-root folder is required; use --help';
  if (opt.wiring && opt.ai)
    opt.error = 'Choose --ai or --wiring-only';
  if (opt.allowRemote && !opt.ai)
    opt.error = '--allow-remote requires --ai';
  return opt;
}
export async function main(args) {
  if (args.includes('--help')) {
    console.log('node run.mjs <web-root> [--out <folder>] [--config <json>] [--ai] [--allow-remote]');
    return 0;
  }
  const opt = parse(args);
  let out, initialized = false;
  try {
    if (opt.error)
      throw Error(opt.error);
    let root;
    try {
      root = canonicalExisting(opt.root);
    } catch {
      throw Error('Source folder not found or not readable');
    }
    out = canonicalOutput(opt.out);
    if (inside(root, out))
      throw Error('Output folder must be outside the selected source');
    initializeOutput(out);
    initialized = true;
    let cfg = {};
    if (opt.configPath) {
      try {
        cfg = readJson(opt.configPath);
      } catch {
        throw Error('Config must be a readable JSON file');
      }
    }
    const {inventory, links} = crawl(root, cfg);
    writeJson(path.join(out, 'site-inventory.json'), inventory);
    writeJson(path.join(out, 'unique-links.json'), links);
    let logic = skipped(links);
    if (opt.ai && inventory.errors.some(e => e.stage === 'scope')) {
      logic = {
        ...logic,
        status: 'failed',
        unresolved: logic.unresolved.map(row => ({
          ...row,
          reason: 'Scope validation incomplete; AI not called'
        })),
        errors: [{
            stage: 'scope',
            message: 'Resolve scope errors before enabling AI'
          }]
      };
    } else if (opt.ai) {
      try {
        logic = await judge(links, makeProvider(cfg, { allowRemote: opt.allowRemote }), cfg);
        logic.provider = cfg.provider;
        logic.model = cfg.model;
      } catch {
        logic = {
          ...logic,
          status: 'failed',
          unresolved: logic.unresolved.map(item => ({
            ...item,
            reason: 'AI setup failed; not reviewed'
          })),
          errors: [{
              stage: 'setup',
              message: 'AI configuration or inventory invalid; review provider settings and remote opt-in'
            }]
        };
      }
    }
    writeJson(path.join(out, 'logic-report.json'), logic);
    fs.writeFileSync(path.join(out, 'logic-crawl-report.html'), render(inventory, logic));
    const failed = inventory.status !== 'completed' || [
      'failed',
      'incomplete'
    ].includes(logic.status);
    writeJson(path.join(out, 'run-manifest.json'), {
      schemaVersion: 2,
      runId: inventory.runId,
      inputDigest: links.inputDigest,
      status: failed ? 'incomplete' : 'completed',
      ai: logic.status
    });
    console.log(`Report: ${ path.join(out, 'logic-crawl-report.html') }\nWiring ${ inventory.status }; AI ${ logic.status }; ${ logic.reviewed }/${ logic.total } reviewed.`);
    return failed ? 2 : 0;
  } catch (e) {
    if (initialized)
      initializeOutput(out, 'failed');
    else {
      try {
        if (!opt.outInvalid)
          invalidatePrior(opt.out, opt.root);
      } catch {
      }
    }
    throw e;
  }
}
const safeErrors = new Set([
  'Option needs a value',
  'Duplicate options are not supported',
  'Unexpected argument; use --help',
  'A web-root folder is required; use --help',
  'Choose --ai or --wiring-only',
  '--allow-remote requires --ai',
  'Source folder not found or not readable',
  'Output folder must be outside the selected source',
  'Output path cannot use symlinks',
  'Output artifacts must be ordinary files without links',
  'Output history must be an ordinary folder',
  'Config must be a readable JSON file',
  'Unknown or invalid config keys',
  'At least one entry is required',
  'Scope paths must be nonempty root-relative paths',
  'Scope path case does not match the source',
  'Scope paths cannot traverse symlinks',
  'Scope file paths cannot end with a slash',
  'The web-root must be a folder'
]);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then(code => process.exitCode = code).catch(e => {
    console.error('Run failed: ' + (safeErrors.has(e.message) ? e.message : 'Unable to read source or write reports; check paths and permissions.'));
    process.exitCode = 1;
  });
