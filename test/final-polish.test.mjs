import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crawl } from '../lib/crawler.mjs';
import { parseHtml } from '../lib/html.mjs';
import { judge } from '../lib/judge.mjs';
import { main } from '../run.mjs';
import {
  digest,
  readJson
} from '../lib/common.mjs';
function fixture(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'logic-final-'))), root = path.join(dir, 'site'), out = path.join(dir, 'out');
  fs.mkdirSync(root);
  for (const [p, s] of Object.entries(files)) {
    const f = path.join(root, p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, s);
  }
  return {
    dir,
    root,
    out
  };
}
for (const [name, prefix, incomplete] of [
    [
      'unquoted-apostrophe',
      '<a href=ok.html title=it\'s>A</a>',
      false
    ],
    [
      'unclosed-quote',
      '<p class="x>text</p>',
      true
    ],
    [
      'bare-less-than',
      '<p>1 < x ',
      false
    ],
    [
      'empty-comment',
      '<!-->',
      false
    ],
    [
      'empty-comment-dash',
      '<!--->',
      false
    ]
  ])
  test('later missing link stays visible: ' + name, () => {
    const f = fixture({
      'index.html': prefix + '<a href="missing.html">B</a>',
      'ok.html': 'OK'
    });
    const c = crawl(f.root);
    assert.equal(c.inventory.summary.brokenLinks, 1);
    assert.equal(c.inventory.status, incomplete ? 'incomplete' : 'completed');
  });
test('malformed quote containing next tag is explicitly incomplete', () => {
  const c = parseHtml('<p title="oops <a href="missing.html">B</a>', 'index.html');
  assert.ok(c.parseIssues.length);
  assert.equal(c.links[0].href, 'missing.html');
});
test('doctype and unterminated attributes never enter excerpts', () => {
  const c = parseHtml('<!doctype html><h1>Visible</h1><div data-k="ATTR_SENTINEL', 'index.html');
  assert.equal(c.excerpt, 'Visible');
  assert.ok(c.parseIssues.length);
  assert.doesNotMatch(c.excerpt, /doctype|ATTR_SENTINEL/);
});
test('doctype with quotes does not hide following links', () => {
  const c = parseHtml('<!DOCTYPE html PUBLIC "a>b"><a href="missing.html">Missing</a>', 'index.html');
  assert.equal(c.links.length, 1);
  assert.doesNotMatch(c.excerpt, /DOCTYPE|PUBLIC/);
});
test('scope path with wrong case refuses before evidence creation', () => {
  const f = fixture({
    'index.html': '<a href="drafts/page.html">Draft</a>',
    'drafts/page.html': 'DRAFT_SENTINEL'
  });
  assert.throws(() => crawl(f.root, { exclude: ['Drafts'] }), /case/);
  assert.throws(() => crawl(f.root, { privatePaths: ['DRAFTS'] }), /case/);
});
test('unmatched explicit scope path is named and makes scan incomplete', () => {
  const f = fixture({ 'index.html': 'Home' });
  const c = crawl(f.root, { exclude: ['future-drafts'] });
  assert.equal(c.inventory.status, 'incomplete');
  assert.equal(c.inventory.errors[0].path, 'future-drafts');
});
test('unmatched scope blocks AI without provider configuration', async () => {
  const f = fixture({
    'index.html': '<a href="drafts.html">Drafts</a>',
    'drafts.html': 'Draft'
  });
  const config = path.join(f.dir, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ exclude: ['future-drafts'] }));
  assert.equal(await main([
    f.root,
    '--out',
    f.out,
    '--config',
    config,
    '--ai'
  ]), 2);
  const r = readJson(path.join(f.out, 'logic-report.json'));
  assert.equal(r.errors[0].stage, 'scope');
  assert.equal(r.reviewed, 0);
});
test('scope checks never traverse a symlink', () => {
  const f = fixture({ 'index.html': 'Home' });
  fs.symlinkSync(f.dir, path.join(f.root, 'alias'));
  assert.throws(() => crawl(f.root, { exclude: ['alias/other'] }), /symlinks/);
});
test('missing or duplicate output option leaves default output unchanged', async () => {
  const f = fixture({ 'index.html': 'Home' });
  await main([
    f.root,
    '--out',
    f.out
  ]);
  const before = fs.readFileSync(path.join(f.out, 'run-manifest.json'), 'utf8');
  const previous = process.cwd();
  process.chdir(f.dir);
  try {
    await assert.rejects(main([
      f.root,
      '--out'
    ]));
    await assert.rejects(main([
      f.root,
      '--out',
      f.out,
      '--out',
      'other'
    ]));
  } finally {
    process.chdir(previous);
  }
  assert.equal(fs.readFileSync(path.join(f.out, 'run-manifest.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(f.out, 'history')), false);
});
test('repeated failed config does not archive disposable placeholders', async () => {
  const f = fixture({ 'index.html': 'Home' });
  await main([
    f.root,
    '--out',
    f.out
  ]);
  const config = path.join(f.dir, 'bad.json');
  fs.writeFileSync(config, '{invalid');
  for (let i = 0; i < 3; i++)
    await assert.rejects(main([
      f.root,
      '--out',
      f.out,
      '--config',
      config
    ]));
  assert.equal(fs.readdirSync(path.join(f.out, 'history')).length, 1);
});
test('file plus extra segment is missing, not invalid URL', () => {
  const f = fixture({
    'index.html': '<a href="about.html/extra">Extra</a>',
    'about.html': 'About'
  });
  assert.equal(crawl(f.root).inventory.mechanical.broken[0].kind, 'missing');
});
test('unquoted href trailing slash is part of URL; quoted self-closing is not', () => {
  const f = fixture({
    'index.html': '<a href=ok.html/>One</a><a href="ok.html"/>Two</a>',
    'ok.html': 'OK'
  });
  const c = crawl(f.root);
  assert.equal(c.inventory.mechanical.broken[0].href, 'ok.html/');
  assert.equal(c.inventory.summary.uniquePromises, 1);
});
test('withheld, malformed, or unlabeled rows make no provider calls', async () => {
  const items = [
    {
      from: 'index',
      linkText: 'Dynamic',
      goesTo: 'x.php',
      dynamic: true
    },
    {
      from: 'index',
      linkText: 'Malformed',
      goesTo: 'x.html',
      evidenceIncomplete: true
    },
    {
      from: 'index',
      linkText: '',
      goesTo: 'about.html'
    }
  ];
  const d = {
    schemaVersion: 2,
    runId: 'no-call',
    inputDigest: digest(items),
    items
  };
  let calls = 0;
  const r = await judge(d, async () => {
    calls++;
    throw Error();
  });
  assert.equal(calls, 0);
  assert.equal(r.attempted, 0);
  assert.equal(r.judged, 0);
  assert.equal(r.verifyAttempted, 0);
  assert.equal(r.unknown, 3);
  assert.equal(r.unresolved.length, 3);
});
test('filtering withheld rows keeps original indices and real call counts', async () => {
  const items = [
    {
      from: 'index',
      linkText: 'PHP',
      goesTo: 'x.php',
      dynamic: true
    },
    {
      from: 'index',
      linkText: 'Pricing',
      goesTo: 'login.html',
      dynamic: false
    }
  ];
  const d = {
    schemaVersion: 2,
    runId: 'filtered',
    inputDigest: digest(items),
    items
  };
  const payloads = [];
  const r = await judge(d, async req => {
    payloads.push(JSON.parse(req.user));
    return payloads.length === 1 ? {
      results: [{
          index: 1,
          verdict: 'problem',
          severity: 'high',
          reason: 'Pricing leads to login',
          fix: 'Fix destination'
        }]
    } : {
      verdict: 'confirmed',
      reason: 'Mismatch',
      severity: 'high'
    };
  });
  assert.equal(payloads[0].length, 1);
  assert.equal(payloads[0][0].index, 1);
  assert.equal(r.attempted, 1);
  assert.equal(r.judged, 1);
  assert.equal(r.verifyAttempted, 1);
  assert.equal(r.unknown, 1);
  assert.equal(r.problems[0].index, 1);
});
test('twenty thousand empty-label anchors stay bounded', () => {
  const start = Date.now();
  const c = parseHtml('<a href="x.html"></a>'.repeat(20000), 'index.html');
  assert.equal(c.links.length, 20000);
  assert.ok(Date.now() - start < 2000);
});
test('valid less-than inside quoted attributes is preserved without leaking attributes', () => {
  const f = fixture({
    'index.html': '<a href="missing.html" title="a<b">B</a><a href="about.html">About</a>',
    'about.html': '<div data-k="a < ATTR_SENTINEL">Visible</div>'
  });
  const c = crawl(f.root);
  assert.equal(c.inventory.summary.brokenLinks, 1);
  assert.equal(c.inventory.status, 'completed');
  assert.doesNotMatch(JSON.stringify(c.links), /ATTR_SENTINEL/);
  assert.equal(c.links.items[0].destExcerpt, 'Visible');
});
test('explicit file scope with trailing slash refuses before AI evidence', () => {
  const f = fixture({
    'index.html': '<a href="team.html">Team</a>',
    'team.html': 'Team'
  });
  assert.throws(() => crawl(f.root, { exclude: ['team.html/'] }), /slash/);
  assert.throws(() => crawl(f.root, { privatePaths: ['team.html/'] }), /slash/);
});
test('base href error is unsupported evidence, not an exclusion-path error', () => {
  const f = fixture({ 'index.html': '<base href="/x/"><a href="missing.html">Missing</a>' });
  const c = crawl(f.root);
  assert.equal(c.inventory.errors[0].stage, 'unsupported');
  assert.equal(c.inventory.status, 'incomplete');
});
test('SYSTEM and PUBLIC declarations with quoted greater-than are withheld', () => {
  for (const declaration of [
      '<!DOCTYPE html SYSTEM "a>b">',
      '<!DOCTYPE html PUBLIC \'a>b\'>'
    ]) {
    const c = parseHtml(declaration + '<h1>Visible</h1>', 'index.html');
    assert.equal(c.excerpt, 'Visible');
    assert.equal(c.parseIssues.length, 0);
  }
});
