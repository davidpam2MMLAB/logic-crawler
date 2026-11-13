import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../lib/judge.mjs';
import { digest } from '../lib/common.mjs';
const item = {
  from: 'index.html',
  linkText: 'Pricing',
  goesTo: 'login.html',
  destTitle: 'Sign in',
  destExcerpt: 'Login',
  sectionExcerpt: '',
  dynamic: false
};
const doc = (n = 1) => {
  const items = Array.from({ length: n }, () => ({ ...item }));
  return {
    schemaVersion: 2,
    runId: 'synthetic-run',
    inputDigest: digest(items),
    items
  };
};
const row = (index = 0, verdict = 'ok') => ({
  index,
  verdict,
  severity: 'high',
  reason: 'Synthetic evidence',
  fix: verdict === 'problem' ? 'Point to pricing' : ''
});
test('valid judgment confirms source-bound finding', async () => {
  let n = 0;
  const r = await judge(doc(), async () => ++n === 1 ? { results: [row(0, 'problem')] } : {
    verdict: 'confirmed',
    reason: 'Pricing points to login',
    severity: 'high'
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.reviewed, 1);
  assert.equal(r.problems[0].goesTo, item.goesTo);
});
test('judge transport failure is failed with unknown coverage', async () => {
  const r = await judge(doc(), async () => {
    throw Error('SECRET_SENTINEL');
  });
  assert.equal(r.status, 'failed');
  assert.equal(r.judgeErrors, 1);
  assert.equal(r.unknown, 1);
  assert.doesNotMatch(JSON.stringify(r), /SECRET_SENTINEL/);
});
test('verifier failure is unknown, not dismissed', async () => {
  let n = 0;
  const r = await judge(doc(), async () => {
    if (++n === 1)
      return { results: [row(0, 'problem')] };
    throw Error('unavailable');
  });
  assert.equal(r.verifyErrors, 1);
  assert.equal(r.dismissed, 0);
  assert.equal(r.unknown, 1);
  assert.equal(r.problems.length, 0);
});
for (const [name, response] of Object.entries({
    empty: {},
    badIndex: { results: [row(999)] },
    fraction: { results: [row(0.5)] },
    extraIdentity: {
      results: [{
          ...row(),
          goesTo: 'forged'
        }]
    },
    badEnum: {
      results: [{
          ...row(),
          verdict: 'pass'
        }]
    },
    wrongType: {
      results: [{
          ...row(),
          reason: true
        }]
    },
    missingRow: { results: [] }
  }))
  test('reject malformed judge: ' + name, async () => {
    const r = await judge(doc(), async () => response);
    assert.equal(r.status, 'failed');
    assert.equal(r.judgeErrors, 1);
    assert.equal(r.reviewed, 0);
  });
test('duplicate indices reject entire batch', async () => {
  const r = await judge(doc(2), async () => ({
    results: [
      row(0),
      row(0)
    ]
  }));
  assert.equal(r.unknown, 2);
  assert.equal(r.judgeErrors, 1);
});
test('batch index cannot point to another batch', async () => {
  let n = 0;
  const r = await judge(doc(2), async () => ({ results: [row(++n === 1 ? 1 : 0)] }), {
    batchSize: 1,
    concurrency: 1
  });
  assert.equal(r.unknown, 2);
});
test('mixed success produces incomplete and exact coverage', async () => {
  let n = 0;
  const r = await judge(doc(2), async () => {
    if (++n === 1)
      return { results: [row(0)] };
    throw Error();
  }, {
    batchSize: 1,
    concurrency: 1
  });
  assert.equal(r.status, 'incomplete');
  assert.equal(r.reviewed, 1);
  assert.equal(r.unknown, 1);
});
test('explicit unknown stays unresolved', async () => {
  const r = await judge(doc(), async () => ({ results: [row(0, 'unknown')] }));
  assert.equal(r.unknown, 1);
  assert.equal(r.reviewed, 0);
});
test('verifier string false is rejected', async () => {
  let n = 0;
  const r = await judge(doc(), async () => ++n === 1 ? { results: [row(0, 'problem')] } : {
    verdict: 'false',
    reason: 'Reason',
    severity: 'low'
  });
  assert.equal(r.verifyErrors, 1);
  assert.equal(r.dismissed, 0);
});
test('dismissed flag counts as reviewed and dismissed', async () => {
  let n = 0;
  const r = await judge(doc(), async () => ++n === 1 ? { results: [row(0, 'problem')] } : {
    verdict: 'dismissed',
    reason: 'Acceptable',
    severity: 'low'
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.dismissed, 1);
  assert.equal(r.problems.length, 0);
});
test('empty inventory writes fresh zero complete result without calls', async () => {
  const r = await judge(doc(0), async () => {
    throw Error('should not call');
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.total, 0);
  assert.equal(r.unknown, 0);
});
test('modified envelope fails before provider call', async () => {
  const d = doc();
  d.items[0].goesTo = 'other';
  await assert.rejects(judge(d, async () => ({})));
});
