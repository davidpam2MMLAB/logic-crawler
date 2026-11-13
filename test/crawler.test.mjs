import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crawl } from '../lib/crawler.mjs';
import { main } from '../run.mjs';
import {
  readJson,
  skipped
} from '../lib/common.mjs';
import { render } from '../lib/report.mjs';
function fixture(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'logic-fixture-'))), root = path.join(dir, 'site'), out = path.join(dir, 'out');
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
const a = (href, label = 'Link') => `<a href="${ href }">${ label }</a>`;
test('clean fixture and cross-page query anchor', () => {
  const {inventory: i} = crawl('fixtures/clean');
  assert.equal(i.summary.brokenLinks, 0);
  assert.equal(i.summary.deadAnchors, 0);
  assert.equal(i.summary.orphanPages, 0);
  assert.equal(i.summary.uniquePromises, 3);
});
test('planted defects have exact expected results', () => {
  const {inventory: i} = crawl('fixtures/defective');
  assert.equal(i.summary.brokenLinks, 1);
  assert.equal(i.summary.deadAnchors, 1);
  assert.deepEqual(i.mechanical.orphanPages, ['orphan.html']);
  assert.equal(i.summary.uniquePromises, 2);
});
test('same-page anchor exists and missing anchor flags', () => {
  const f = fixture({ 'index.html': a('#missing') + a('#yes') + '<h2 id="yes">Yes</h2>' });
  const {inventory: i} = crawl(f.root);
  assert.equal(i.summary.deadAnchors, 1);
  assert.equal(i.summary.uniquePromises, 1);
});
test('query missing path and anchor both checked', () => {
  const f = fixture({
    'index.html': a('missing.html?q=1') + a('about.html?q=1#missing'),
    'about.html': 'About'
  });
  const {inventory: i} = crawl(f.root);
  assert.equal(i.summary.brokenLinks, 1);
  assert.equal(i.summary.deadAnchors, 1);
});
test('encoded filename and fragment, root and directory indexes', () => {
  const f = fixture({
    'index.html': a('our%20team.html#caf%C3%A9') + a('/docs/'),
    'our team.html': '<h2 id="café">Café</h2>',
    'docs/index.php': '<h1>Documents</h1>'
  });
  const {inventory: i} = crawl(f.root);
  assert.equal(i.summary.brokenLinks, 0);
  assert.equal(i.summary.deadAnchors, 0);
  assert.equal(i.summary.orphanPages, 0);
});
test('protocol-relative URLs are external, other schemes unchecked', () => {
  const f = fixture({ 'index.html': a('//example.invalid/test') + a('data:text/plain,hello') + a('javascript:void(0)') });
  const {inventory: i} = crawl(f.root);
  assert.equal(i.summary.brokenLinks, 0);
  assert.deepEqual(i.unchecked.map(l => l.kind), [
    'external',
    'unsupported',
    'unsupported'
  ]);
});
test('unreachable links never enter semantic inventory or public findings', () => {
  const f = fixture({
    'index.html': 'Home',
    'draft.html': a('about.html') + a('missing.html'),
    'about.html': 'About'
  });
  const {inventory: i} = crawl(f.root);
  assert.equal(i.summary.uniquePromises, 0);
  assert.equal(i.summary.brokenLinks, 0);
  assert.equal(i.summary.orphanPages, 2);
});
test('filenames with spaces preserve downstream reachability', () => {
  const f = fixture({
    'index.html': a('our team.html'),
    'our team.html': a('about.html'),
    'about.html': 'About'
  });
  assert.equal(crawl(f.root).inventory.summary.orphanPages, 0);
});
test('default excludes backup, staging, internal and archives', () => {
  const f = fixture({
    'index.html': 'Home',
    'backup/old.html': a('missing.html'),
    'staging/test.html': 'Draft',
    'internal/x.html': 'Internal',
    '_archive/x.html': 'Old'
  });
  assert.equal(crawl(f.root).inventory.summary.pagesScanned, 1);
});
test('explicit scope overrides defaults', () => {
  const f = fixture({
    'index.html': a('staging/x.html'),
    'staging/x.html': 'Preview'
  });
  assert.equal(crawl(f.root, { exclude: [] }).inventory.summary.pagesScanned, 2);
});
test('private routes flag public link but never enter AI workload', () => {
  const f = fixture({
    'index.html': a('admin/index.html'),
    'admin/index.html': a('deep.html'),
    'admin/deep.html': 'Private'
  });
  const c = crawl(f.root);
  assert.equal(c.inventory.summary.backendExposures, 1);
  assert.equal(c.links.items.length, 0);
  assert.equal(c.inventory.summary.reachablePages, 1);
});
test('excluded linked destination is unchecked, never broken or AI input', () => {
  const f = fixture({
    'index.html': a('staging/x.html'),
    'staging/x.html': 'Preview'
  });
  const c = crawl(f.root);
  assert.equal(c.inventory.summary.brokenLinks, 0);
  assert.equal(c.inventory.unchecked[0].kind, 'excluded');
  assert.equal(c.links.items.length, 0);
});
test('missing entry gives incomplete scan', () => {
  const f = fixture({ 'home.html': 'Home' });
  assert.equal(crawl(f.root).inventory.status, 'incomplete');
});
test('section excerpt contains the target rather than only page opening', () => {
  const f = fixture({
    'index.html': a('about.html#target'),
    'about.html': '<h1>About</h1>' + '<p>Intro</p>'.repeat(300) + '<section id="target">TARGET EVIDENCE</section>'
  });
  assert.match(crawl(f.root).links.items[0].sectionExcerpt, /TARGET EVIDENCE/);
});
test('comments, scripts and PHP blocks are not inventoried as visible links', () => {
  const f = fixture({ 'index.html': '<!--' + a('x.html') + '--><script>' + a('y.html') + '</script><?php echo "PRIVATE_SENTINEL"; ?><h1>Home</h1>' });
  const c = crawl(f.root);
  assert.equal(c.links.items.length, 0);
  assert.equal(c.inventory.summary.brokenLinks, 0);
  assert.doesNotMatch(JSON.stringify(c), /PRIVATE_SENTINEL/);
});
test('outside href rejected without reading destination', () => {
  const f = fixture({ 'index.html': a('../outside.html') });
  fs.writeFileSync(path.join(f.dir, 'outside.html'), 'OUTSIDE_SENTINEL');
  const c = crawl(f.root);
  assert.equal(c.inventory.mechanical.broken[0].kind, 'outside-root');
  assert.doesNotMatch(JSON.stringify(c), /OUTSIDE_SENTINEL/);
});
test('symlink directories, files, broken links and cycles not followed', () => {
  const f = fixture({ 'index.html': a('linked/private.html') + a('alias.html') });
  fs.mkdirSync(path.join(f.dir, 'external'));
  fs.writeFileSync(path.join(f.dir, 'external/private.html'), 'OUTSIDE_SENTINEL');
  fs.symlinkSync(path.join(f.dir, 'external'), path.join(f.root, 'linked'));
  fs.symlinkSync(path.join(f.dir, 'external/private.html'), path.join(f.root, 'alias.html'));
  fs.symlinkSync(f.root, path.join(f.root, 'cycle'));
  fs.symlinkSync(path.join(f.dir, 'absent'), path.join(f.root, 'broken'));
  const c = crawl(f.root);
  assert.equal(c.inventory.summary.pagesScanned, 1);
  assert.equal(c.inventory.summary.brokenLinks, 2);
  assert.equal(c.inventory.skippedPaths.length, 4);
  assert.doesNotMatch(JSON.stringify(c), /OUTSIDE_SENTINEL/);
});
test('CLI requires root and refuses unknown flags', async () => {
  await assert.rejects(main([]));
  await assert.rejects(main([
    'fixtures/clean',
    '--wat'
  ]));
});
test('CLI wiring refreshes stale AI report and prints fresh manifest', async () => {
  const f = fixture({ 'index.html': a('#yes') + '<h2 id="yes">Yes</h2>' });
  fs.mkdirSync(f.out);
  fs.writeFileSync(path.join(f.out, 'logic-report.json'), '{"stale":true}');
  assert.equal(await main([
    f.root,
    '--out',
    f.out
  ]), 0);
  const l = readJson(path.join(f.out, 'logic-report.json'));
  assert.equal(l.status, 'skipped');
  assert.equal(l.reviewed, 0);
  assert.equal(l.unknown, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(f.out, 'logic-crawl-report.html'), 'utf8'), /stale|keep their promise/);
});
test('empty AI run cannot retain prior results', async () => {
  const f = fixture({ 'index.html': 'Home' });
  assert.equal(await main([
    f.root,
    '--out',
    f.out
  ]), 0);
  assert.equal(readJson(path.join(f.out, 'logic-report.json')).total, 0);
});
test('CLI incomplete entry exits 2 and output cannot be within root', async () => {
  const f = fixture({ 'home.html': 'Home' });
  assert.equal(await main([
    f.root,
    '--out',
    f.out
  ]), 2);
  await assert.rejects(main([
    f.root,
    '--out',
    path.join(f.root, 'out')
  ]));
});
test('AI misconfiguration writes fresh failed report and exits 2', async () => {
  const f = fixture({
    'index.html': a('about.html'),
    'about.html': 'About'
  });
  assert.equal(await main([
    f.root,
    '--out',
    f.out,
    '--ai'
  ]), 2);
  assert.equal(readJson(path.join(f.out, 'logic-report.json')).status, 'failed');
});
test('report rejects mismatched run and escapes hostile page content', () => {
  const c = crawl('fixtures/clean');
  const l = skipped(c.links);
  assert.throws(() => render(c.inventory, {
    ...l,
    runId: 'different'
  }));
  assert.throws(() => render(c.inventory, {
    ...l,
    inputDigest: 'different'
  }));
  c.inventory.site = '<script>alert(1)</script>';
  const html = render(c.inventory, l);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
test('output artifacts cannot be symlinks or hardlinks to other files', async () => {
  for (const kind of [
      'symlink',
      'hardlink'
    ]) {
    const f = fixture({ 'index.html': 'Home' });
    fs.mkdirSync(f.out);
    const external = path.join(f.dir, 'sentinel.txt');
    fs.writeFileSync(external, 'UNCHANGED');
    const alias = path.join(f.out, 'logic-crawl-report.html');
    if (kind === 'symlink')
      fs.symlinkSync(external, alias);
    else
      fs.linkSync(external, alias);
    await assert.rejects(main([
      f.root,
      '--out',
      f.out
    ]));
    assert.equal(fs.readFileSync(external, 'utf8'), 'UNCHANGED');
  }
});
test('failed fresh run replaces old HTML with unfinished notice', async () => {
  const f = fixture({ 'index.html': 'Home' });
  await main([
    f.root,
    '--out',
    f.out
  ]);
  const config = path.join(f.dir, 'bad.json');
  fs.writeFileSync(config, '{invalid');
  await assert.rejects(main([
    f.root,
    '--out',
    f.out,
    '--config',
    config
  ]));
  assert.match(fs.readFileSync(path.join(f.out, 'logic-crawl-report.html'), 'utf8'), /Run unfinished/);
  assert.equal(readJson(path.join(f.out, 'run-manifest.json')).status, 'failed');
});
test('base href pages are incomplete, never resolved against the wrong path', () => {
  const f = fixture({
    'index.html': '<base href="/docs/">' + a('about.html'),
    'about.html': 'Wrong destination',
    'docs/about.html': 'Correct destination'
  });
  const c = crawl(f.root);
  assert.equal(c.inventory.status, 'incomplete');
  assert.equal(c.links.items.length, 0);
  assert.equal(c.inventory.unchecked[0].kind, 'unsupported-base');
});
test('empty entry configuration cannot claim a completed public scan', () => {
  assert.throws(() => crawl('fixtures/clean', { entries: [] }), /entry/);
});
test('PHP handler without closing tag cannot leak server source to AI evidence', () => {
  const f = fixture({
    'index.html': a('checkout.php'),
    'checkout.php': '<?php $privateValue = "PHP_PRIVATE_SENTINEL"; redirect();'
  });
  const c = crawl(f.root);
  assert.equal(c.links.items.length, 1);
  assert.equal(c.links.items[0].dynamic, true);
  assert.equal(c.links.items[0].destExcerpt, '');
  assert.doesNotMatch(JSON.stringify(c), /PHP_PRIVATE_SENTINEL/);
});
