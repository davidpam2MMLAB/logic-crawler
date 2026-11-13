import fs from 'node:fs';
import path from 'node:path';
import {
  runId,
  readJson,
  writeJson,
  inside,
  canonicalExisting
} from './common.mjs';
const artifacts = [
  'logic-crawl-report.html',
  'run-manifest.json',
  'site-inventory.json',
  'unique-links.json',
  'logic-report.json'
];
export function canonicalOutput(folder) {
  const absolute = path.resolve(folder);
  let cur = path.parse(absolute).root;
  for (const part of absolute.slice(cur.length).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    try {
      if (fs.lstatSync(cur).isSymbolicLink())
        throw new Error('Output path cannot use symlinks');
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw e;
    }
  }
  let parent = absolute, rest = [];
  while (!fs.existsSync(parent)) {
    rest.unshift(path.basename(parent));
    parent = path.dirname(parent);
  }
  return path.join(canonicalExisting(parent), ...rest);
}
function checkArtifacts(out) {
  for (const name of artifacts) {
    try {
      const st = fs.lstatSync(path.join(out, name));
      if (!st.isFile() || st.isSymbolicLink() || st.nlink > 1)
        throw Error('Output artifacts must be ordinary files without links');
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw e;
    }
  }
}
export function initializeOutput(out, status = 'running') {
  fs.mkdirSync(out, { recursive: true });
  checkArtifacts(out);
  const present = artifacts.filter(name => {
    const file = path.join(out, name);
    if (!fs.existsSync(file))
      return false;
    if (name.endsWith('.json')) {
      try {
        if (readJson(file)._placeholder === true)
          return false;
      } catch {
      }
    }
    if (name.endsWith('.html') && fs.readFileSync(file, 'utf8').startsWith('<!doctype html><title>Run unfinished</title>'))
      return false;
    return true;
  });
  if (present.length) {
    const history = path.join(out, 'history');
    try {
      const st = fs.lstatSync(history);
      if (!st.isDirectory() || st.isSymbolicLink())
        throw Error('Output history must be an ordinary folder');
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw e;
    }
    const archive = path.join(history, runId());
    fs.mkdirSync(archive, { recursive: true });
    for (const name of present)
      fs.renameSync(path.join(out, name), path.join(archive, name));
  }
  const id = runId();
  for (const name of artifacts.filter(n => n.endsWith('.json')))
    writeJson(path.join(out, name), {
      status,
      _placeholder: true,
      runId: id
    });
  fs.writeFileSync(path.join(out, 'logic-crawl-report.html'), `<!doctype html><title>Run unfinished</title><h1>Run unfinished</h1><p>Run status: ${ status }. This attempt did not produce a completed report. Previous files are archived in history.</p>`);
}
export function invalidatePrior(folder, source) {
  // On an early input error only retire an existing recognizable output set.
  // Never initialize a new destination or write into a valid selected source.
  const out = canonicalOutput(folder);
  if (source) {
    try {
      if (inside(canonicalExisting(source), out))
        return false;
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw e;
    }
  }
  checkArtifacts(out);
  let manifest;
  try {
    manifest = readJson(path.join(out, 'run-manifest.json'));
  } catch {
    return false;
  }
  if (![
      'running',
      'completed',
      'incomplete',
      'failed'
    ].includes(manifest.status))
    return false;
  initializeOutput(out, 'failed');
  return true;
}
