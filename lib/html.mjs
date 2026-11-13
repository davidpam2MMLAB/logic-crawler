// A bounded static scanner, not a browser DOM. Never extracts PHP source.
export function entities(s) {
  return s.replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[\da-f]+|\d+);/gi, x => {
    if (x.startsWith('&#')) {
      const n = x[2].toLowerCase() === 'x' ? parseInt(x.slice(3, -1), 16) : Number(x.slice(2, -1));
      return n > 0 && n <= 1114111 ? String.fromCodePoint(n) : '\uFFFD';
    }
    return {
      amp: '&',
      quot: '"',
      apos: '\'',
      lt: '<',
      gt: '>'
    }[x.slice(1, -1).toLowerCase()];
  });
}
function attributes(source) {
  const result = {};
  for (const m of source.matchAll(/([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!Object.hasOwn(result, name))
      result[name] = entities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return result;
}
// Find a tag boundary using HTML attribute states, not every quote character.
function boundary(raw, start, declaration = false) {
  let state = 'before', quote = '';
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (c === '<' && state !== 'quoted')
      return {
        end: i,
        malformed: true
      };
    if (declaration && !quote && (c === '"' || c === '\'')) {
      quote = c;
      state = 'quoted';
      continue;
    }
    // A complete tag-like sequence inside a quoted value is ambiguous to this static
    // recovery scanner. Flag it rather than silently swallowing later anchors.
    if (c === '<' && state === 'quoted' && /^<\/?[a-z][\w:-]*(?:\s+[\w:-]+\s*=|>)/i.test(raw.slice(i, i + 150)))
      return {
        end: i,
        malformed: true
      };
    if (state === 'quoted') {
      if (c === quote) {
        state = 'before';
        quote = '';
      }
      continue;
    }
    if (c === '>')
      return {
        end: i + 1,
        malformed: false
      };
    if (state === 'unquoted') {
      if (/\s/.test(c))
        state = 'before';
      continue;
    }
    if (state === 'value') {
      if (/\s/.test(c))
        continue;
      if (c === '"' || c === '\'') {
        state = 'quoted';
        quote = c;
      } else
        state = 'unquoted';
      continue;
    }
    if (c === '=')
      state = 'value';
  }
  return {
    end: raw.length,
    malformed: true
  };
}
function scan(raw) {
  const tokens = [], chunks = [], issues = [];
  let i = 0, copied = 0;
  function mask(start, end) {
    chunks.push(raw.slice(copied, start), ' '.repeat(end - start));
    copied = end;
  }
  while (i < raw.length) {
    const start = raw.indexOf('<', i);
    if (start < 0)
      break;
    if (raw.startsWith('<!--', start)) {
      const abrupt = raw.startsWith('<!-->', start) ? start + 5 : raw.startsWith('<!--->', start) ? start + 6 : null;
      const close = abrupt ?? raw.indexOf('-->', start + 4);
      i = abrupt ?? (close < 0 ? raw.length : close + 3);
      if (!abrupt && close < 0)
        issues.push('Unterminated comment withheld');
      mask(start, i);
      continue;
    }
    if (raw.startsWith('<!', start)) {
      const found = boundary(raw, start + 2, true);
      i = found.end;
      mask(start, i);
      if (found.malformed)
        issues.push('Malformed or unterminated declaration withheld');
      continue;
    }
    // Whitespace after '<' is literal text, not a tag opener.
    const head = /^<(\/?)([a-z][\w:-]*)\b/i.exec(raw.slice(start, start + 150));
    if (!head) {
      i = start + 1;
      continue;
    }
    const found = boundary(raw, start + head[0].length);
    i = found.end;
    if (found.malformed) {
      mask(start, i);
      issues.push('Malformed or unterminated tag withheld');
      continue;
    }
    const name = head[2].toLowerCase(), closing = !!head[1];
    if (!closing && [
        'script',
        'style'
      ].includes(name)) {
      const re = new RegExp('</' + name + '(?=[\\s/>])', 'ig');
      re.lastIndex = i;
      const close = re.exec(raw);
      const end = close ? boundary(raw, re.lastIndex) : {
        end: raw.length,
        malformed: true
      };
      i = end.end;
      if (end.malformed)
        issues.push('Unterminated raw-text block withheld');
      mask(start, i);
      continue;
    }
    tokens.push({
      name,
      closing,
      start,
      end: i,
      attrs: closing ? {} : attributes(raw.slice(start + head[0].length, i - 1))
    });
  }
  chunks.push(raw.slice(copied));
  return {
    html: chunks.join(''),
    tokens,
    issues
  };
}
export function text(source) {
  const {html, tokens} = scan(source);
  let i = 0, pieces = [];
  for (const t of tokens) {
    pieces.push(html.slice(i, t.start), ' ');
    i = t.end;
  }
  pieces.push(html.slice(i));
  return entities(pieces.join('')).replace(/\s+/g, ' ').trim();
}
export function parseHtml(raw, from) {
  // Withhold the whole mixed PHP file: delimiters inside comments/strings are
  // language-dependent. No source fragment from such files may reach AI.
  if (raw.includes('<?'))
    return {
      title: '',
      h1: '',
      excerpt: '',
      html: '',
      ids: new Map(),
      links: [],
      hasBase: false,
      dynamic: true,
      parseIssues: []
    };
  const {html, tokens, issues} = scan(raw), ids = new Map(), links = [];
  let active = null;
  function finish(end) {
    if (!active)
      return;
    const content = html.slice(active.end, end);
    let label = text(content);
    if (!label)
      label = active.altLabels.join(' ').trim();
    links.push({
      from,
      href: active.attrs.href,
      linkText: label.slice(0, 200)
    });
    active = null;
  }
  for (const t of tokens) {
    if (!t.closing) {
      for (const id of [
          t.attrs.id,
          t.name === 'a' ? t.attrs.name : null
        ])
        if (id)
          ids.set(id, t.start);
    }
    if (t.name === 'a') {
      finish(t.start);
      if (!t.closing && t.attrs.href !== undefined)
        active = {
          ...t,
          altLabels: []
        };
    }
    if (active && t.name === 'img' && !t.closing && t.attrs.alt)
      active.altLabels.push(t.attrs.alt);
    if (t.name === 'area' && !t.closing && t.attrs.href !== undefined)
      links.push({
        from,
        href: t.attrs.href,
        linkText: (t.attrs.alt ?? '').slice(0, 200)
      });
  }
  finish(html.length);
  function heading(name) {
    const open = tokens.find(t => t.name === name && !t.closing);
    if (!open)
      return '';
    const close = tokens.find(t => t.name === name && t.closing && t.start >= open.end);
    return text(html.slice(open.end, close?.start ?? html.length));
  }
  return {
    title: heading('title'),
    h1: heading('h1'),
    excerpt: text(html).slice(0, 1000),
    html,
    ids,
    links,
    hasBase: tokens.some(t => t.name === 'base' && !t.closing && t.attrs.href !== undefined),
    dynamic: false,
    parseIssues: issues
  };
}
