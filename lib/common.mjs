import fs from 'node:fs';
import path from 'node:path';
import {
  createHash,
  randomUUID
} from 'node:crypto';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const runId = () => randomUUID();
export const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
}
export const inside = (root, p) => p === root || !path.relative(root, p).startsWith('..' + path.sep) && path.relative(root, p) !== '..' && !path.isAbsolute(path.relative(root, p));
export function assertEnvelope(doc) {
  if (doc?.schemaVersion !== 2 || typeof doc.runId !== 'string' || !Array.isArray(doc.items) || doc.inputDigest !== digest(doc.items))
    throw new Error('Invalid or modified link inventory');
}
export const skipped = doc => ({
  schemaVersion: 2,
  runId: doc.runId,
  inputDigest: doc.inputDigest,
  status: 'skipped',
  total: doc.items.length,
  reviewed: 0,
  unknown: doc.items.length,
  judgeErrors: 0,
  verifyErrors: 0,
  problems: [],
  dismissed: 0,
  dismissedItems: [],
  unresolved: doc.items.map((item, index) => ({
    index,
    from: item.from,
    linkText: item.linkText,
    goesTo: item.goesTo,
    reason: 'AI review not requested'
  })),
  errors: []
});
// realpath on case-insensitive macOS can retain the caller's spelling.
// Recover stored component names and verify aliases by file identity.
export function canonicalExisting(file) {
  const resolved = fs.realpathSync(file);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    const names = fs.readdirSync(current);
    let name = names.includes(part) ? part : names.find(n => n.normalize('NFC').toLowerCase() === part.normalize('NFC').toLowerCase());
    if (!name)
      throw new Error('Cannot canonicalize filesystem spelling');
    if (name !== part) {
      const a = fs.statSync(path.join(current, part)), b = fs.statSync(path.join(current, name));
      if (a.dev !== b.dev || a.ino !== b.ino)
        throw new Error('Ambiguous filesystem spelling');
    }
    current = path.join(current, name);
  }
  return current;
}
