import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeProvider } from '../providers/index.mjs';
const req = {
  system: 'Synthetic system',
  user: 'Synthetic item',
  schema: { type: 'object' }
};
async function mock(t, handler) {
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${ server.address().port }`;
}
test('remote requires separate explicit opt-in, credentials in URL forbidden', () => {
  assert.throws(() => makeProvider({
    provider: 'openai',
    model: 'synthetic'
  }), /allow-remote/);
  assert.throws(() => makeProvider({
    provider: 'openai-compatible',
    model: 'synthetic',
    baseUrl: 'http://example.invalid/v1'
  }, { allowRemote: true }), /HTTPS/);
  assert.throws(() => makeProvider({
    provider: 'openai-compatible',
    model: 'synthetic',
    baseUrl: 'http://user:secret@localhost/v1'
  }), /credentials/);
});
test('local transport posts expected content and parses JSON', async t => {
  let received;
  const base = await mock(t, async (req, res) => {
    let body = '';
    for await (const b of req)
      body += b;
    received = JSON.parse(body);
    assert.equal(req.url, '/v1/chat/completions');
    res.end(JSON.stringify({ choices: [{ message: { content: '{"results":[]}' } }] }));
  });
  const p = makeProvider({
    provider: 'openai-compatible',
    model: 'synthetic',
    baseUrl: base + '/v1'
  });
  assert.deepEqual(await p(req), { results: [] });
  assert.match(received.messages[1].content, /Synthetic item/);
});
test('HTTP body never leaks into errors', async t => {
  const base = await mock(t, (_req, res) => {
    res.writeHead(503);
    res.end('SECRET_SENTINEL');
  });
  const p = makeProvider({
    provider: 'openai-compatible',
    model: 'synthetic',
    baseUrl: base
  });
  await assert.rejects(p(req), e => e.message === 'Provider HTTP 503');
});
test('redirect refused without forwarding credential', async t => {
  let forwarded = false;
  const target = await mock(t, (_req, res) => {
    forwarded = true;
    res.end('{}');
  });
  const base = await mock(t, (_req, res) => {
    res.writeHead(302, { location: target });
    res.end();
  });
  const p = makeProvider({
    provider: 'openai-compatible',
    model: 'synthetic',
    baseUrl: base
  });
  await assert.rejects(p(req));
  assert.equal(forwarded, false);
});
test('request deadline bounds hanging response', async t => {
  const base = await mock(t, () => {
  });
  const p = makeProvider({
    provider: 'openai-compatible',
    model: 'synthetic',
    baseUrl: base,
    timeoutMs: 30
  });
  const start = Date.now();
  await assert.rejects(p(req));
  assert.ok(Date.now() - start < 2000);
});
test('invalid JSON returns neutral error', async t => {
  const base = await mock(t, (_req, res) => res.end('SECRET_SENTINEL'));
  const p = makeProvider({
    provider: 'openai-compatible',
    model: 'synthetic',
    baseUrl: base
  });
  await assert.rejects(p(req), e => !e.message.includes('SECRET_SENTINEL'));
});
test('Anthropic adapter uses tools and reads tool payload locally', async t => {
  const base = await mock(t, async (req, res) => {
    let body = '';
    for await (const b of req)
      body += b;
    assert.equal(req.url, '/v1/messages');
    assert.equal(JSON.parse(body).tool_choice.name, 'report');
    res.end(JSON.stringify({
      content: [{
          type: 'tool_use',
          input: { results: [] }
        }]
    }));
  });
  const p = makeProvider({
    provider: 'anthropic',
    model: 'synthetic',
    baseUrl: base
  });
  assert.deepEqual(await p(req), { results: [] });
});
test('OpenAI adapter requests strict schema locally', async t => {
  const base = await mock(t, async (req, res) => {
    let body = '';
    for await (const b of req)
      body += b;
    assert.equal(JSON.parse(body).response_format.json_schema.strict, true);
    res.end(JSON.stringify({ choices: [{ message: { content: '{"results":[]}' } }] }));
  });
  assert.deepEqual(await makeProvider({
    provider: 'openai',
    model: 'synthetic',
    baseUrl: base + '/v1'
  })(req), { results: [] });
});
