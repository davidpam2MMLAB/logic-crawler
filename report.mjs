import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './lib/common.mjs';
import { render } from './lib/report.mjs';
try {
  const [invFile, logicFile, out] = process.argv.slice(2);
  if (!out || path.dirname(path.resolve(invFile)) !== path.dirname(path.resolve(logicFile)))
    throw Error();
  const inv = readJson(invFile), logic = readJson(logicFile);
  const manifest = readJson(path.join(path.dirname(invFile), 'run-manifest.json'));
  if (![
      'completed',
      'incomplete'
    ].includes(manifest.status) || manifest.runId !== inv.runId || manifest.inputDigest !== inv.inputDigest)
    throw Error();
  try {
    const st = fs.lstatSync(out);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink > 1)
      throw Error();
  } catch (e) {
    if (e.code !== 'ENOENT')
      throw e;
  }
  fs.writeFileSync(out, render(inv, logic));
} catch {
  console.error('Report refused: provide matching inventory, AI result and completed/incomplete run manifest from one folder, and an ordinary output file.');
  process.exitCode = 1;
}
