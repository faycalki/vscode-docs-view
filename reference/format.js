'use strict';

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const kindLabels = {
  class: 'Class',
  method: 'Method',
  attribute: 'Attribute',
  accessor: 'Accessor',
  function: 'Function',
  callable: 'Callable',
  module: 'Module',
  constant: 'Constant',
  syntax: 'Python syntax'
};
const isParam = (title) =>
  /^(parameters|other parameters|args|arguments|keyword args|keyword arguments|attributes)$/i.test(
    title
  );
const isExample = (title) => /^(?:quick )?examples?$/i.test(title);

function inline(text) {
  // Render only inline code and Sphinx cross-references, leaving all other text literal.
  const parts = String(text).split(/((?::[\w:]+:)?`{1,2}[^`\n]+`{1,2})/g);
  return parts
    .map((part, i) =>
      i % 2 ? '<code>' + esc(part.replace(/^(?::[\w:]+:)?`+~?|`+$/g, '')) + '</code>' : esc(part)
    )
    .join('');
}

function sectionsOf(body) {
  const out = [{ title: '', lines: [] }],
    lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const title = lines[i].trim();
    if (title && /^[=~^-]{3,}$/.test((lines[i + 1] || '').trim()) && !/^[=~^-]+$/.test(title)) {
      out.push({ title, lines: [] });
      i++;
    } else if (
      /^(args|arguments|parameters|keyword args|keyword arguments|attributes|returns|yields|raises|examples?|notes|shape):$/i.test(
        title
      )
    ) {
      out.push({ title: title.slice(0, -1), lines: [] });
    } else out[out.length - 1].lines.push(lines[i]);
  }
  return out;
}

function parameterRows(lines, googleStyle) {
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
  const rows = [];
  let row;
  for (const original of lines) {
    const line = original.slice(indent);
    const m =
      /^(\*{0,2}[A-Za-z_]\w*(?:(?:\s*,\s*|\s+or\s+)\*{0,2}[A-Za-z_]\w*)*)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/.exec(
        line
      );
    if (m) {
      const names = m[1].split(/\s*,\s*|\s+or\s+/).map((n) => n.replace(/^\*+/, ''));
      // NumPy puts the type after a colon. Google-style docstrings put it in parentheses.
      const typedInParens = m[2] !== undefined || googleStyle;
      row = {
        label: m[1],
        names,
        type: typedInParens ? m[2] : m[3],
        lines: typedInParens && m[3] ? [m[3]] : []
      };
      rows.push(row);
    } else {
      if (!row) {
        row = { lines: [] };
        rows.push(row);
      }
      row.lines.push(line);
    }
  }
  return rows;
}

function markedCode(source, params = new Set()) {
  let end = 0,
    out = '';
  const tokens = /#.*$|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\b\d+(?:\.\d+)?\b|[A-Za-z_]\w*/gm;
  for (const m of source.matchAll(tokens)) {
    const t = m[0];
    out += esc(source.slice(end, m.index));
    end = m.index + t.length;
    if (params.has(t))
      out +=
        '<button class="ref-param-link" data-param-jump="' +
        esc(t) +
        '" title="Read ' +
        esc(t) +
        '">' +
        esc(t) +
        '</button>';
    else {
      const category =
        t[0] === '#'
          ? 'comment'
          : /^['"]/.test(t)
            ? 'string'
            : /^(None|True|False|\d)/.test(t)
              ? 'literal'
              : /^(?:from|import|as|with|if|else|for|in|def|class|return|yield|await)$/.test(t)
                ? 'keyword'
                : '';
      out += category ? '<span class="ref-' + category + '">' + esc(t) + '</span>' : esc(t);
    }
  }
  return out + esc(source.slice(end));
}

function ownerOf(e, catalog) {
  if (!['method', 'attribute', 'accessor'].includes(e.kind)) return;
  const parts = e.name.split('.');
  let immediate;
  for (let i = parts.length - 1; i > 0; i--) {
    const path = parts.slice(0, i).join('.');
    const parent = catalog.names.get(path);
    if (i === parts.length - 1)
      immediate = { path, link: parent && parent.kind !== 'module' ? path : undefined };
    if (parent?.kind === 'class') return { path, link: path };
  }
  return immediate;
}

function definitionList(rows) {
  return rows
    .map((row) => {
      const text = row.lines.join('\n').trim();
      if (!row.names) return text ? '<div class="ref-prose">' + inline(text) + '</div>' : '';
      return (
        '<dl class="ref-definition" tabindex="-1" data-params="' +
        esc(row.names.join(' ')) +
        '"><dt><strong>' +
        esc(row.label) +
        '</strong>' +
        (row.type ? '<span class="ref-type">' + inline(row.type) + '</span>' : '') +
        '</dt>' +
        (text ? '<dd>' + inline(text.replace(/^[ \t]+/gm, '')) + '</dd>' : '') +
        '</dl>'
      );
    })
    .join('');
}

function formatEntry(entry, body, catalog) {
  const sections = sectionsOf(body),
    params = new Set();
  for (const s of sections) {
    if (isParam(s.title)) {
      s.rows = parameterRows(
        s.lines,
        /^(?:args|arguments|keyword args|keyword arguments)$/i.test(s.title)
      );
      for (const row of s.rows) for (const n of row.names || []) params.add(n);
    }
  }
  const owner = ownerOf(entry, catalog),
    leaf = entry.name.split('.').pop();
  let heading = esc(entry.topic ? entry.name.slice(8) : leaf);
  if (owner) {
    const label = esc(owner.path.split('.').pop());
    const root = owner.link
      ? '<button data-ref-action="parent" class="ref-owner ref-owner-link" title="Open ' +
        esc(owner.link) +
        '">' +
        label +
        '</button>'
      : '<strong class="ref-owner">' + label + '</strong>';
    heading =
      root +
      '<span class="ref-dot">.</span><span class="ref-member">' +
      esc(entry.name.slice(owner.path.length + 1)) +
      '</span>';
  } else if (entry.kind === 'class') heading = '<strong class="ref-owner">' + heading + '</strong>';
  const origin = entry.pack.local
    ? 'Your environment'
    : entry.pack.kind === 'starter'
      ? 'Starter reference'
      : 'Bundled reference';
  const quick = sections.findIndex((s) => /^quick example/i.test(s.title));
  const jumps = [
    ['Parameters', sections.findIndex((s) => isParam(s.title))],
    ['Returns', sections.findIndex((s) => /^(?:returns|yields)$/i.test(s.title))],
    ['Examples', quick >= 0 ? quick : sections.findIndex((s) => isExample(s.title))]
  ].filter((j) => j[1] >= 0);
  const nav = jumps.length
    ? '<nav class="ref-jumps" aria-label="Jump to documentation section">' +
      jumps
        .map(([label, i]) => '<button data-section-jump="' + i + '">' + label + '</button>')
        .join('') +
      '</nav>'
    : '';
  const details = sections
    .map((s, i) => {
      const text = s.lines.join('\n').trim();
      if (!s.title) {
        let intro = text;
        // NumPy ufuncs and extension types often repeat a multi-line signature before the first paragraph.
        if (/^[\w.]+\(/.test(intro) && intro.includes('\n\n'))
          intro = intro.slice(intro.indexOf('\n\n') + 2).trim();
        const head = intro.split(/\n\s*\n/, 1)[0];
        if (head?.replace(/\s+/g, ' ').trim() === entry.summary) intro = intro.slice(head.length).trim();
        return intro ? '<div class="ref-prose">' + inline(intro) + '</div>' : '';
      }
      const content = s.rows
        ? definitionList(s.rows)
        : isExample(s.title)
          ? '<pre class="ref-example"><code>' + markedCode(text) + '</code></pre>'
          : '<div class="ref-prose">' + inline(text) + '</div>';
      return (
        '<details class="ref-section" data-section="' +
        i +
        '"' +
        (isParam(s.title) || isExample(s.title) ? ' open' : '') +
        '><summary>' +
        esc(s.title) +
        '</summary>' +
        content +
        '</details>'
      );
    })
    .join('');
  const tag = kindLabels[entry.kind] || 'Reference';
  const title = '<h2 class="ref-heading">' + heading + '</h2>';
  const canonical = entry.topic ? '' : '<div class="ref-path">' + esc(entry.name) + '</div>';
  const summary =
    entry.summary && !/^(?:\w+=[^ ]*,?\s*)+\)/.test(entry.summary)
      ? '<p class="ref-summary">' + inline(entry.summary) + '</p>'
      : '';
  const html =
    '<section class="ref-card"><div class="ref-meta"><span class="ref-kind">' +
    esc(tag) +
    '</span><span>' +
    esc(entry.pack.label) +
    ' ' +
    esc(entry.pack.version) +
    ' · ' +
    origin +
    '</span></div>' +
    title +
    canonical +
    (entry.sig
      ? '<pre class="ref-signature"><code>' + markedCode(entry.sig, params) + '</code></pre>'
      : '') +
    summary +
    nav +
    details +
    '</section>';
  return { name: entry.name, owner: owner?.link, html };
}
module.exports = { formatEntry };
