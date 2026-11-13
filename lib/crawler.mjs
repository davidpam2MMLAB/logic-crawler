import fs from 'node:fs';
import path from 'node:path';
import {
  inside,
  digest,
  runId
} from './common.mjs';
const defaults = [
  '.git',
  'node_modules',
  'backup',
  'staging',
  '_archive',
  'internal'
];
import {
  parseHtml,
  text
} from './html.mjs';
export function crawl(root, config = {}) {
  root = fs.realpathSync(root);
  if (!fs.statSync(root).isDirectory())
    throw new Error('The web-root must be a folder');
  const allowed = [
    'entries',
    'exclude',
    'privatePaths',
    'provider',
    'model',
    'baseUrl',
    'apiKeyEnv',
    'timeoutMs',
    'batchSize',
    'concurrency'
  ];
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => !allowed.includes(k)))
    throw new Error('Unknown or invalid config keys');
  const entries = config.entries ?? ['index.html'];
  const excludes = config.exclude ?? defaults;
  const privatePaths = config.privatePaths ?? ['admin'];
  if (!Array.isArray(entries) || entries.length === 0)
    throw new Error('At least one entry is required');
  for (const v of [
      entries,
      excludes,
      privatePaths
    ])
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !x || x.includes('\\') || x.startsWith('/') || x.split('/').some(p => p === '..' || p === '.') || /[*?\[\]{}]/.test(x) || x.includes('//')))
      throw new Error('Scope paths must be nonempty root-relative paths');
  const scopeIssues = [];
  for (const key of [
      'exclude',
      'privatePaths'
    ]) {
    if (!Object.hasOwn(config, key))
      continue;
    for (const entry of config[key]) {
      let cur = root, missing = false;
      for (const part of entry.replace(/\/$/, '').split('/')) {
        let names;
        try {
          names = fs.readdirSync(cur);
        } catch {
          missing = true;
          break;
        }
        if (!names.includes(part)) {
          if (names.some(n => n.toLowerCase() === part.toLowerCase()))
            throw new Error('Scope path case does not match the source');
          missing = true;
          break;
        }
        cur = path.join(cur, part);
        if (fs.lstatSync(cur).isSymbolicLink())
          throw new Error('Scope paths cannot traverse symlinks');
      }
      if (!missing && entry.endsWith('/') && !fs.statSync(cur).isDirectory())
        throw new Error('Scope file paths cannot end with a slash');
      if (missing)
        scopeIssues.push({
          stage: 'scope',
          path: entry,
          message: 'Configured scope path matches nothing; correct it before AI review'
        });
    }
  }
  const matches = (rel, list) => list.some(p => rel === p || rel.startsWith(p.replace(/\/$/, '') + '/'));
  const excluded = rel => rel.split('/').some(p => p.startsWith('.')) || matches(rel, excludes);
  const pages = new Map(), skippedPaths = [], errors = [...scopeIssues];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, ent.name), rel = path.relative(root, full).split(path.sep).join('/');
      if (ent.isSymbolicLink()) {
        skippedPaths.push({
          path: rel,
          reason: 'symlink'
        });
        continue;
      }
      if (excluded(rel)) {
        skippedPaths.push({
          path: rel,
          reason: 'excluded'
        });
        continue;
      }
      if (ent.isDirectory())
        walk(full);
      else if (ent.isFile() && /\.(html?|php)$/i.test(ent.name)) {
        const raw = fs.readFileSync(full, 'utf8');
        pages.set(rel, parseHtml(raw, rel));
      }
    }
  }
  walk(root);
  // Inspect each component without following a symlink, including non-HTML targets.
  function safeState(rel) {
    if (!inside(root, path.resolve(root, rel)))
      return 'outside-root';
    if (excluded(rel))
      return 'excluded';
    let cur = root;
    for (const part of rel.split('/').filter(Boolean)) {
      if (!fs.statSync(cur).isDirectory())
        return 'missing';
      const names = fs.readdirSync(cur);
      if (!names.includes(part))
        return names.some(n => n.toLowerCase() === part.toLowerCase()) ? 'case-mismatch' : 'missing';
      cur = path.join(cur, part);
      let st;
      try {
        st = fs.lstatSync(cur);
      } catch {
        return 'missing';
      }
      if (st.isSymbolicLink())
        return 'symlink';
    }
    return fs.statSync(cur).isDirectory() ? 'directory' : 'file';
  }
  function resolve(href, from) {
    let h = href.trim();
    if (!h || h === '#')
      return { kind: 'empty' };
    if (/^(https?:)?\/\//i.test(h))
      return { kind: 'external' };
    if (/^(mailto|tel):/i.test(h))
      return { kind: 'contact' };
    if (/^[a-z][\w+.-]*:/i.test(h))
      return { kind: 'unsupported' };
    if (h.includes('${') || h.includes('<?'))
      return { kind: 'dynamic' };
    const hash = h.indexOf('#'), frag = hash < 0 ? '' : h.slice(hash + 1);
    h = hash < 0 ? h : h.slice(0, hash);
    h = h.split('?')[0];
    try {
      h = decodeURIComponent(h);
      const anchor = decodeURIComponent(frag);
      if (h.includes('\\') || h.includes('\0'))
        return { kind: 'unsupported' };
      const abs = h ? path.resolve(h.startsWith('/') ? root : path.dirname(path.join(root, from)), h.replace(/^\/+/, '')) : path.join(root, from);
      if (!inside(root, abs))
        return { kind: 'outside-root' };
      let target = path.relative(root, abs).split(path.sep).join('/');
      let state = safeState(target);
      if (h.endsWith('/') && state === 'file')
        state = 'not-directory';
      if (state === 'directory') {
        const idx = [
          'index.html',
          'index.htm',
          'index.php'
        ].find(p => safeState(target ? target + '/' + p : p) === 'file');
        if (!idx)
          return {
            kind: 'missing-index',
            target,
            anchor
          };
        target = target ? target + '/' + idx : idx;
        state = safeState(target);
      }
      return {
        kind: state === 'file' ? 'internal' : state,
        target,
        anchor
      };
    } catch {
      return { kind: 'invalid-url' };
    }
  }
  const links = [...pages.values()].flatMap(p => p.links).map(l => ({
    ...l,
    ...pages.get(l.from).hasBase ? { kind: 'unsupported-base' } : resolve(l.href, l.from)
  }));
  for (const entry of entries)
    if (!pages.has(entry) || matches(entry, privatePaths))
      errors.push({
        stage: 'entry',
        path: entry,
        message: 'Entry is missing, excluded, or private'
      });
  const seen = new Set(), queue = entries.filter(e => pages.has(e) && !matches(e, privatePaths));
  const adj = new Map();
  for (const l of links)
    if (l.kind === 'internal' && !matches(l.target, privatePaths)) {
      if (!adj.has(l.from))
        adj.set(l.from, []);
      adj.get(l.from).push(l.target);
    }
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p))
      continue;
    seen.add(p);
    for (const t of adj.get(p) ?? [])
      if (pages.has(t))
        queue.push(t);
  }
  const publicLinks = links.filter(l => seen.has(l.from));
  for (const p of seen)
    if (pages.get(p)?.hasBase)
      errors.push({
        stage: 'unsupported',
        path: p,
        message: 'Base href is unsupported; links on this page were not resolved'
      });
  for (const p of seen)
    if (pages.get(p)?.dynamic)
      errors.push({
        stage: 'evidence',
        path: p,
        message: 'PHP or processing-instruction page withheld; static links and content were not extracted'
      });
  for (const p of seen)
    for (const message of pages.get(p)?.parseIssues ?? [])
      errors.push({
        stage: 'markup',
        path: p,
        message
      });
  const broken = publicLinks.filter(l => [
    'missing',
    'missing-index',
    'outside-root',
    'symlink',
    'invalid-url',
    'case-mismatch',
    'not-directory'
  ].includes(l.kind));
  const deadAnchors = publicLinks.filter(l => l.kind === 'internal' && l.anchor && pages.has(l.target) && !pages.get(l.target).ids.has(l.anchor) && l.anchor.toLowerCase() !== 'top');
  const backendExposure = publicLinks.filter(l => l.kind === 'internal' && matches(l.target, privatePaths));
  const orphanPages = [...pages.keys()].filter(p => !seen.has(p) && !matches(p, privatePaths));
  const unique = new Map();
  for (const l of publicLinks) {
    if (l.kind !== 'internal' || !pages.has(l.target) || matches(l.target, privatePaths) || deadAnchors.includes(l))
      continue;
    const p = pages.get(l.target);
    const section = l.anchor && p.ids.has(l.anchor) ? p.html.slice(p.ids.get(l.anchor), p.ids.get(l.anchor) + 6000) : '';
    const item = {
      from: l.from,
      linkText: l.linkText,
      goesTo: l.target + (l.anchor ? '#' + l.anchor : ''),
      destTitle: p.title,
      destH1: p.h1,
      destExcerpt: p.excerpt,
      sectionExcerpt: l.anchor ? text(section).slice(0, 2000) : '',
      dynamic: p.dynamic,
      evidenceIncomplete: p.parseIssues?.length > 0
    };
    const k = JSON.stringify([
      item.linkText,
      item.goesTo,
      item.sectionExcerpt
    ]);
    if (!unique.has(k))
      unique.set(k, item);
  }
  const items = [...unique.values()], id = runId(), inputDigest = digest(items);
  const inventory = {
    schemaVersion: 2,
    runId: id,
    inputDigest,
    site: path.basename(root),
    status: errors.length ? 'incomplete' : 'completed',
    entries,
    scope: {
      exclude: excludes,
      privatePaths
    },
    errors,
    summary: {
      pagesScanned: pages.size,
      reachablePages: seen.size,
      brokenLinks: broken.length,
      deadAnchors: deadAnchors.length,
      backendExposures: backendExposure.length,
      orphanPages: orphanPages.length,
      uniquePromises: items.length
    },
    mechanical: {
      broken,
      deadAnchors,
      backendExposure,
      orphanPages
    },
    skippedPaths,
    unchecked: publicLinks.filter(l => ![
      'internal',
      'missing',
      'missing-index',
      'outside-root',
      'symlink',
      'invalid-url',
      'case-mismatch',
      'not-directory'
    ].includes(l.kind))
  };
  return {
    inventory,
    links: {
      schemaVersion: 2,
      runId: id,
      inputDigest,
      items
    }
  };
}
