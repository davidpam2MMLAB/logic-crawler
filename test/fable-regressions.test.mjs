import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { crawl } from '../lib/crawler.mjs';
import { main } from '../run.mjs';
import { judge } from '../lib/judge.mjs';
import {
  digest,
  readJson,
  skipped
} from '../lib/common.mjs';
import { render } from '../lib/report.mjs';
function fixture(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'logic-fable-'))), root = path.join(dir, 'site'), out = path.join(dir, 'out');
  fs.mkdirSync(root);
  for (const [name, data] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  return {
    dir,
    root,
    out
  };
}
for (const [name, php] of Object.entries({
    comment: '<?php /* note ?> */ DBPASS="PHP_SENTINEL"; ?><h1>Pay</h1>',
    string: '<?php $x="?>"; $secret="PHP_SENTINEL"; ?><h1>Pay</h1>',
    mixed: '<h1>Pay</h1><?php $x="PHP_SENTINEL"; ?>',
    noClose: '<?php $x="PHP_SENTINEL";'
  })) {
  test('PHP source withheld: ' + name, async () => {
    const f = fixture({
      'index.html': '<a href="pay.php">Pay</a>',
      'pay.php': php
    });
    const c = crawl(f.root);
    assert.doesNotMatch(JSON.stringify(c), /PHP_SENTINEL/);
    assert.equal(c.links.items[0].dynamic, true);
    assert.equal(c.links.items[0].destExcerpt, '');
    assert.equal(c.inventory.status, 'incomplete');
    let payload = '';
    await judge(c.links, async req => {
      payload += req.user;
      return {
        results: [{
            index: 0,
            verdict: 'ok',
            severity: 'low',
            reason: 'Synthetic',
            fix: ''
          }]
      };
    });
    assert.doesNotMatch(payload, /PHP_SENTINEL/);
  });
}
for (const [name, markup] of Object.entries({
    unclosedScript: '<script>var key="RAW_SENTINEL";',
    spacedClose: '<script>var key="RAW_SENTINEL";</SCRIPT >',
    unclosedStyle: '<style>.x{content:"RAW_SENTINEL"}',
    unclosedComment: '<!-- note > RAW_SENTINEL',
    comment: '<!-- note > RAW_SENTINEL -->'
  }))
  test('raw text not in evidence: ' + name, () => {
    const f = fixture({
      'index.html': '<a href="target.html">Target</a>',
      'target.html': markup
    });
    assert.doesNotMatch(JSON.stringify(crawl(f.root).links), /RAW_SENTINEL/);
  });
test('withheld PHP outbound links are not scanned as public HTML', () => {
  const f = fixture({
    'index.php': '<?php /* ?> */ <a href="secret.html">Secret</a> ?>',
    'secret.html': 'Secret'
  });
  const c = crawl(f.root, { entries: ['index.php'] });
  assert.equal(c.links.items.length, 0);
  assert.equal(c.inventory.status, 'incomplete');
});
for (const [name, cfg] of Object.entries({
    typo: { excludes: ['drafts'] },
    glob: { exclude: ['drafts/*'] },
    globQuestion: { privatePaths: ['admin?'] },
    nullConfig: null,
    array: [],
    dot: { exclude: ['.'] }
  }))
  test('unsafe config rejected: ' + name, () => {
    const f = fixture({ 'index.html': 'Home' });
    assert.throws(() => crawl(f.root, cfg));
  });
test('quoted greater-than and nested anchors do not swallow links', () => {
  for (const markup of [
      '<a title="a>b" href="missing.html">x</a>',
      '<a href="ok.html">A <a href="missing.html">B</a>'
    ]) {
    const f = fixture({
      'index.html': markup,
      'ok.html': 'OK'
    });
    assert.equal(crawl(f.root).inventory.summary.brokenLinks, 1);
  }
});
test('unquoted href, area, image alt and empty links are accounted for', () => {
  const f = fixture({
    'index.html': '<a href=about.html><img src=x alt="About us"></a><area href="missing.html" alt="Map"><a href="#">Top</a><a href="">Here</a>',
    'about.html': 'About'
  });
  const c = crawl(f.root);
  assert.equal(c.inventory.summary.brokenLinks, 1);
  assert.equal(c.links.items[0].linkText, 'About us');
  assert.equal(c.inventory.unchecked.filter(l => l.kind === 'empty').length, 2);
});
test('browser top fragment and trailing slash on a file', () => {
  const f = fixture({
    'index.html': '<a href="#top">Top</a><a href="about.html/">About</a>',
    'about.html': 'About'
  });
  const i = crawl(f.root).inventory;
  assert.equal(i.summary.deadAnchors, 0);
  assert.equal(i.mechanical.broken[0].kind, 'not-directory');
});
test('exact case mismatch is explicit even on a case-insensitive disk', () => {
  const f = fixture({
    'index.html': '<a href="About.html">About</a><a href="Admin/index.html">Admin</a>',
    'about.html': 'About',
    'admin/index.html': 'Private'
  });
  const c = crawl(f.root);
  assert.equal(c.inventory.summary.brokenLinks, 2);
  assert.ok(c.inventory.mechanical.broken.every(l => l.kind === 'case-mismatch'));
  assert.equal(c.links.items.length, 0);
});
test('case-variant output cannot write inside source', async t => {
  const f = fixture({ 'index.html': 'Home' });
  const alias = path.join(f.dir, 'SITE');
  if (!fs.existsSync(alias)) {
    t.skip('Filesystem is case-sensitive');
    return;
  }
  await assert.rejects(main([
    f.root,
    '--out',
    path.join(alias, 'reports')
  ]), /outside/);
  assert.equal(fs.existsSync(path.join(f.root, 'reports')), false);
});
for (const kind of [
    'bad-root',
    'bad-flag',
    'bad-config'
  ])
  test('failed attempt invalidates active output: ' + kind, async () => {
    const f = fixture({ 'index.html': 'Home' });
    await main([
      f.root,
      '--out',
      f.out
    ]);
    const old = readJson(path.join(f.out, 'run-manifest.json')).runId;
    const args = [
      kind === 'bad-root' ? f.root + '-typo' : f.root,
      '--out',
      f.out
    ];
    if (kind === 'bad-flag')
      args.unshift('--unknown');
    if (kind === 'bad-config') {
      const p = path.join(f.dir, 'bad.json');
      fs.writeFileSync(p, '{SECRET_SENTINEL');
      args.push('--config', p);
    }
    await assert.rejects(main(args));
    assert.equal(readJson(path.join(f.out, 'run-manifest.json')).status, 'failed');
    assert.match(fs.readFileSync(path.join(f.out, 'logic-crawl-report.html'), 'utf8'), /Run unfinished/);
    for (const name of [
        'site-inventory.json',
        'unique-links.json',
        'logic-report.json'
      ])
      assert.equal(readJson(path.join(f.out, name)).status, 'failed');
    const history = path.join(f.out, 'history');
    assert.ok(fs.readdirSync(history).some(d => {
      const p = path.join(history, d, 'run-manifest.json');
      return fs.existsSync(p) && readJson(p).runId === old;
    }));
    const r = spawnSync(process.execPath, [
      'report.mjs',
      path.join(f.out, 'site-inventory.json'),
      path.join(f.out, 'logic-report.json'),
      path.join(f.dir, 'fake.html')
    ], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
  });
test('report CLI refuses failed manifest even with old matching JSON', async () => {
  const f = fixture({ 'index.html': 'Home' });
  await main([
    f.root,
    '--out',
    f.out
  ]);
  const manifest = path.join(f.out, 'run-manifest.json');
  const m = readJson(manifest);
  fs.writeFileSync(manifest, JSON.stringify({
    ...m,
    status: 'failed'
  }));
  const r = spawnSync(process.execPath, [
    'report.mjs',
    path.join(f.out, 'site-inventory.json'),
    path.join(f.out, 'logic-report.json'),
    path.join(f.dir, 'fake.html')
  ]);
  assert.notEqual(r.status, 0);
});
test('CLI error explains containment without dumping config content', () => {
  const f = fixture({ 'index.html': 'Home' });
  const r = spawnSync(process.execPath, [
    'run.mjs',
    f.root,
    '--out',
    path.join(f.root, 'out')
  ], { encoding: 'utf8' });
  assert.match(r.stderr, /outside the selected source/);
});
test('unknown and dismissed rows identify source links', async () => {
  const item = {
    from: 'index.html',
    linkText: 'Pricing',
    goesTo: 'login.html',
    dynamic: false
  };
  const items = [
    item,
    {
      ...item,
      linkText: 'Team'
    }
  ];
  const doc = {
    schemaVersion: 2,
    runId: 'neutral',
    items,
    inputDigest: digest(items)
  };
  let call = 0;
  const r = await judge(doc, async () => ++call === 1 ? {
    results: [
      {
        index: 0,
        verdict: 'unknown',
        severity: 'low',
        reason: 'Insufficient evidence',
        fix: ''
      },
      {
        index: 1,
        verdict: 'problem',
        severity: 'low',
        reason: 'Review',
        fix: 'Check'
      }
    ]
  } : {
    verdict: 'dismissed',
    reason: 'Reasonable destination',
    severity: 'low'
  });
  assert.equal(r.unresolved[0].goesTo, 'login.html');
  assert.equal(r.dismissedItems[0].linkText, 'Team');
  assert.equal(r.unresolved.length, r.unknown);
});
test('judge and verifier transport unknowns identify input rows', async () => {
  const c = crawl('fixtures/clean');
  const r = await judge(c.links, async () => {
    throw Error();
  });
  assert.equal(r.unresolved.length, c.links.items.length);
  assert.ok(r.unresolved.every(x => x.from && x.goesTo));
});
test('report shows missing entry path and stage', () => {
  const f = fixture({ 'home.html': 'Home' });
  const c = crawl(f.root, { entries: ['absent.html'] });
  const html = render(c.inventory, skipped(c.links));
  assert.match(html, /entry/);
  assert.match(html, /absent.html/);
});
test('large unclosed comment input is bounded and withheld', () => {
  const f = fixture({
    'index.html': '<a href="target.html">Target</a>',
    'target.html': '<!--'.repeat(20000) + 'COMMENT_SENTINEL'
  });
  const start = Date.now();
  const c = crawl(f.root);
  assert.doesNotMatch(JSON.stringify(c.links), /COMMENT_SENTINEL/);
  assert.ok(Date.now() - start < 3000);
});
