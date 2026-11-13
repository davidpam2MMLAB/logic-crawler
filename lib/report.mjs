const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;'
}[c]));
export function render(inv, logic) {
  if (inv?.schemaVersion !== 2 || logic?.schemaVersion !== 2 || !inv.runId || inv.runId !== logic.runId || !inv.inputDigest || inv.inputDigest !== logic.inputDigest)
    throw new Error('Reports belong to different runs or inputs');
  const table = (rows, cols) => rows.length ? '<table><tr>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr>' + rows.map(r => '<tr>' + cols.map(c => '<td>' + esc(r[c]) + '</td>').join('') + '</tr>').join('') + '</table>' : '<p>No findings in this category.</p>';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logic Crawler report</title><style>body{font:17px/1.55 system-ui;margin:32px auto;padding:0 20px;max-width:1000px;color:#17232e}h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%;display:block;overflow:auto}td,th{padding:8px;border:1px solid #ccd3da;text-align:left;overflow-wrap:anywhere}aside{padding:16px;background:#edf2f7;border-left:4px solid #34688c}.warn{background:#fff0d1}code{overflow-wrap:anywhere}li{margin:6px 0}</style><h1>Logic Crawler</h1><p>Site: ${ esc(inv.site) } · Run: <code>${ esc(inv.runId) }</code></p><aside class="${ logic.unknown || inv.errors.length ? 'warn' : '' }">Wiring: ${ esc(inv.status) }. AI review: <b>${ esc(logic.status) }</b>.<br>AI reviewed ${ esc(logic.reviewed) } of ${ esc(logic.total) } link promises; ${ esc(logic.unknown) } unchecked or unresolved. Confirmed flags: ${ logic.problems.length }.</aside><p>Static source review only. No browser actions, external URL checks, PHP execution, or certification that a site works. AI findings are advisory. No confirmed flags does not mean every link is correct.</p><h2>Scan summary</h2><ul>${ Object.entries(inv.summary).map(([k, v]) => '<li>' + esc(k) + ': ' + esc(v) + '</li>').join('') }</ul><h2>Run errors</h2>${ table([
    ...inv.errors,
    ...logic.errors
  ], [
    'stage',
    'path',
    'message'
  ]) }<h2>Broken or unsafe destinations</h2>${ table(inv.mechanical.broken, [
    'from',
    'linkText',
    'href',
    'kind'
  ]) }<h2>Missing anchors</h2>${ table(inv.mechanical.deadAnchors, [
    'from',
    'linkText',
    'href',
    'anchor'
  ]) }<h2>Links to configured private routes</h2><p>This is a source-link finding, not proof of server access.</p>${ table(inv.mechanical.backendExposure, [
    'from',
    'linkText',
    'href'
  ]) }<h2>Unreachable pages</h2>${ table(inv.mechanical.orphanPages.map(path => ({ path })), ['path']) }<h2>AI findings</h2>${ table(logic.problems, [
    'from',
    'linkText',
    'goesTo',
    'severity',
    'why',
    'fix'
  ]) }<h2>Unresolved AI items</h2>${ table(logic.unresolved ?? [], [
    'index',
    'from',
    'linkText',
    'goesTo',
    'reason'
  ]) }<h2>Dismissed AI flags</h2>${ table(logic.dismissedItems ?? [], [
    'index',
    'from',
    'linkText',
    'goesTo',
    'reason'
  ]) }<h2>Excluded or unsupported evidence</h2>${ table(inv.skippedPaths, [
    'path',
    'reason'
  ]) }${ table(inv.unchecked, [
    'from',
    'href',
    'kind'
  ]) }<footer><p>The selected source was read; reports were written to the output folder. AI content is sent only when explicitly enabled.</p></footer></html>`;
}
