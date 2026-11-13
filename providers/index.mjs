// Transport only. Runtime judgment validation lives in lib/judge.mjs.
export function makeProvider(cfg, {
  allowRemote = false
} = {}) {
  if (![
      'anthropic',
      'openai',
      'openai-compatible'
    ].includes(cfg.provider) || typeof cfg.model !== 'string' || !cfg.model)
    throw new Error('Choose a supported provider and model');
  const base = cfg.baseUrl || (cfg.provider === 'anthropic' ? 'https://api.anthropic.com' : cfg.provider === 'openai' ? 'https://api.openai.com/v1' : '');
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error('Provider needs a valid baseUrl');
  }
  const local = [
    'localhost',
    '127.0.0.1',
    '[::1]'
  ].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Provider URL must not contain credentials, query, or fragment');
  if (![
      'https:',
      'http:'
    ].includes(url.protocol) || !local && url.protocol !== 'https:')
    throw new Error('Remote providers require HTTPS');
  if (!local && !allowRemote)
    throw new Error('Remote AI requires --allow-remote; site excerpts will leave this machine');
  const key = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : '';
  if (cfg.apiKeyEnv && !key)
    throw new Error('Configured provider key is missing');
  const timeout = cfg.timeoutMs ?? 30000;
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 120000)
    throw new Error('timeoutMs must be 10\u2013120000');
  const endpoint = base.replace(/\/$/, '') + (cfg.provider === 'anthropic' ? '/v1/messages' : '/chat/completions');
  return async ({system, user, schema}) => {
    const anthropic = cfg.provider === 'anthropic';
    const body = anthropic ? {
      model: cfg.model,
      max_tokens: 4096,
      system,
      messages: [{
          role: 'user',
          content: user
        }],
      tool_choice: {
        type: 'tool',
        name: 'report'
      },
      tools: [{
          name: 'report',
          description: 'Return review evidence',
          input_schema: schema
        }]
    } : {
      model: cfg.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'system',
          content: system + '\nReturn JSON matching this schema: ' + JSON.stringify(schema)
        },
        {
          role: 'user',
          content: user
        }
      ],
      response_format: cfg.provider === 'openai' ? {
        type: 'json_schema',
        json_schema: {
          name: 'report',
          strict: true,
          schema
        }
      } : { type: 'json_object' }
    };
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        headers: {
          'content-type': 'application/json',
          ...key ? anthropic ? {
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
          } : { authorization: 'Bearer ' + key } : {},
          ...anthropic ? { 'anthropic-version': '2023-06-01' } : {}
        },
        body: JSON.stringify(body)
      });
      if (!res.ok)
        throw new Error('http:' + res.status);
      const reader = res.body.getReader();
      let chunks = '', bytes = 0;
      const dec = new TextDecoder();
      while (true) {
        const {done, value} = await reader.read();
        if (done)
          break;
        bytes += value.length;
        if (bytes > 2000000) {
          await reader.cancel();
          throw new Error('oversize');
        }
        chunks += dec.decode(value, { stream: true });
      }
      chunks += dec.decode();
      const data = JSON.parse(chunks);
      if (anthropic)
        return data.content?.find(c => c.type === 'tool_use')?.input;
      const txt = data.choices?.[0]?.message?.content;
      if (typeof txt !== 'string')
        throw new Error('response');
      return JSON.parse(txt.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
    } catch (e) {
      if (/^http:\d+$/.test(e.message))
        throw new Error('Provider HTTP ' + e.message.slice(5));
      throw new Error('Provider request failed, timed out, or returned invalid JSON');
    }
  };
}
