'use strict';

// Bind imported names and simple local assignments without importing the user's program.
const byDocument = new WeakMap();
const factories = new Map(
  Object.entries({
    'pandas.read_csv': 'pandas.DataFrame',
    'pandas.read_parquet': 'pandas.DataFrame',
    'pandas.read_excel': 'pandas.DataFrame',
    'pandas.read_json': 'pandas.DataFrame',
    'pandas.read_feather': 'pandas.DataFrame',
    'pandas.DataFrame.groupby': 'pandas.api.typing.DataFrameGroupBy',
    'pandas.Series.groupby': 'pandas.api.typing.SeriesGroupBy',
    'pandas.DataFrame.rolling': 'pandas.api.typing.Rolling',
    'pandas.Series.rolling': 'pandas.api.typing.Rolling',
    'pandas.DataFrame.resample': 'pandas.api.typing.Resampler',
    'pandas.Series.resample': 'pandas.api.typing.Resampler',
    'numpy.array': 'numpy.ndarray',
    'numpy.asarray': 'numpy.ndarray',
    'numpy.arange': 'numpy.ndarray',
    'numpy.linspace': 'numpy.ndarray',
    'numpy.zeros': 'numpy.ndarray',
    'numpy.ones': 'numpy.ndarray',
    'numpy.empty': 'numpy.ndarray',
    'numpy.random.default_rng': 'numpy.random.Generator',
    'torch.tensor': 'torch.Tensor',
    'torch.zeros': 'torch.Tensor',
    'torch.ones': 'torch.Tensor',
    'sklearn.metrics.ConfusionMatrixDisplay.from_predictions': 'sklearn.metrics.ConfusionMatrixDisplay',
    'sklearn.metrics.ConfusionMatrixDisplay.from_estimator': 'sklearn.metrics.ConfusionMatrixDisplay'
  })
);
const keywords = new Map([
  ['for', 'for'],
  ['while', 'while'],
  ['if', 'if'],
  ['elif', 'if'],
  ['else', 'if'],
  ['def', 'def'],
  ['class', 'class'],
  ['lambda', 'lambda'],
  ['with', 'with'],
  ['try', 'try / except'],
  ['except', 'try / except'],
  ['async', 'async / await'],
  ['await', 'async / await'],
  ['yield', 'yield'],
  ['return', 'return'],
  ['break', 'break / continue'],
  ['continue', 'break / continue'],
  ['assert', 'assert'],
  ['match', 'match / case'],
  ['case', 'match / case']
]);
const ident = /^[a-zA-Z_]\w*$/;

function mask(text) {
  return text.replace(
    /#[^\n]*|"""(?:\\[\s\S]|(?!""")[\s\S])*(?:"""|$)|'''(?:\\[\s\S]|(?!''')[\s\S])*(?:'''|$)|"(?:\\.|[^"\\\n])*(?:"|$)|'(?:\\.|[^'\\\n])*(?:'|$)/gm,
    (part) => part.replace(/[^\n]/g, ' ')
  );
}

function analyze(doc) {
  const known = byDocument.get(doc);
  if (known && known.version === doc.version) return known;
  const lines = mask(doc.getText()).split(/\r?\n/);
  const root = { parent: null, names: new Map() };
  const stack = [{ indent: -1, scope: root }];
  const scopes = [];
  let continuation = null;
  function record(scope, name, value, row) {
    if (!ident.test(name)) return;
    if (!scope.names.has(name)) scope.names.set(name, []);
    scope.names.get(name).push({ row, value });
  }
  function imports(scope, stmt, row) {
    const from = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(stmt);
    const list = from ? from[2] : stmt.replace(/^import\s+/, '');
    for (const item of list.replace(/[()\\]/g, '').split(',')) {
      const m = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(item);
      if (!m) continue;
      const target = from ? from[1] + '.' + m[1] : m[1];
      const name = m[2] || (from ? m[1] : m[1].split('.')[0]);
      record(scope, name, { direct: from || m[2] ? target : name }, row);
    }
  }
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row],
      stmt = line.trim();
    if (continuation) {
      scopes[row] = continuation.scope;
      continuation.text += ' ' + stmt;
      if (
        !stmt.endsWith('\\') &&
        (!continuation.text.includes('(') || continuation.text.includes(')'))
      ) {
        imports(continuation.scope, continuation.text, continuation.row);
        continuation = null;
      }
      continue;
    }
    const indent = line.match(/^\s*/)[0].replace(/\t/g, '        ').length;
    if (stmt) while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const scope = stack[stack.length - 1].scope;
    scopes[row] = scope;
    if (/^(?:from\s+[.\w]+\s+import|import)\s/.test(stmt)) {
      if (stmt.endsWith('\\') || (stmt.includes('(') && !stmt.includes(')')))
        continuation = { text: stmt, row, scope };
      else imports(scope, stmt, row);
      continue;
    }
    const def = /^(?:async\s+)?(def|class)\s+(\w+)\b(.*)/.exec(stmt);
    if (def) {
      record(scope, def[2], null, row);
      const child = { parent: scope, names: new Map() };
      stack.push({ indent, scope: child });
      if (def[1] === 'def') {
        const params = /^\s*\(([^)]*)/.exec(def[3]);
        for (const param of (params?.[1] || '').split(',')) {
          const m = /^\s*\**(\w+)(?:\s*:\s*([\w.]+))?/.exec(param);
          if (m) record(child, m[1], m[2] ? { expr: m[2], scope, row } : null, row);
        }
      }
      continue;
    }
    const tuple = /^(\w+)\s*,\s*(\w+)\s*=\s*([\w.]+)\s*\(/.exec(stmt);
    if (tuple) {
      for (const [i, name] of [tuple[1], tuple[2]].entries())
        record(scope, name, { tuple: i, expr: tuple[3], scope, row }, row + 1);
      continue;
    }
    const assign = /^(\w+)\s*(?::\s*([\w.]+)[^=]*)?\s*=\s*(?!=)(.*)/.exec(stmt);
    if (assign) record(scope, assign[1], { expr: assign[2] || assign[3], scope, row }, row + 1);
    const local = /^(?:for|async\s+for|del)\s+(\w+)\b/.exec(stmt);
    if (local) record(scope, local[1], null, row);
  }
  const result = { version: doc.version, lines, scopes, root };
  byDocument.set(doc, result);
  return result;
}

function symbolAt(line, col) {
  const word =
    [...line.matchAll(/[A-Za-z_]\w*/g)].find((m) => m.index <= col && col < m.index + m[0].length) ||
    [...line.matchAll(/[A-Za-z_]\w*/g)].find((m) => m.index + m[0].length === col);
  if (!word) return null;
  // Collapse balanced calls so df.groupby("col").mean can resolve each receiver.
  let left = line.slice(0, word.index + word[0].length);
  let prev;
  do {
    prev = left;
    left = left.replace(/\([^()]*\)/g, '@');
  } while (left !== prev);
  const match = /([A-Za-z_]\w*(?:@?\s*\.\s*[A-Za-z_]\w*)*)$/.exec(left);
  if (!match || left.slice(0, match.index).trimEnd().endsWith('.')) return null;
  return { expr: match[1].replace(/\s/g, ''), leaf: word[0] };
}

function returnType(value) {
  if (!value) return null;
  if (/^sklearn\.(?:\w+\.)+[A-Z]\w*\.fit$/.test(value)) return value.slice(0, -4);
  if (factories.has(value)) return factories.get(value);
  if (/\.[A-Z]\w*$/.test(value) || value === 'numpy.ndarray') return value;
  return null;
}

function resolve(doc, pos, catalog, previous = []) {
  const current = analyze(doc),
    token = symbolAt(current.lines[pos.line] || '', pos.character);
  if (!token) return null;
  const scopes = previous.map(analyze).reverse();
  function lookup(name, scope, row, cell, depth) {
    if (depth > 16) return null;
    for (let s = scope; s; s = s.parent) {
      const bindings = s.names.get(name);
      const binding = bindings && [...bindings].reverse().find((b) => b.row <= row);
      if (!binding) {
        // Python treats assignments anywhere in a function as local.
        if (bindings && s.parent) return null;
        continue;
      }
      const b = binding.value;
      if (!b) return null;
      if (b.direct) return b.direct;
      const target = expression(b.expr, b.scope, b.row, cell, depth + 1);
      if (b.tuple !== undefined)
        return target === 'matplotlib.pyplot.subplots'
          ? ['matplotlib.figure.Figure', 'matplotlib.axes.Axes'][b.tuple]
          : null;
      return target;
    }
    if (cell < scopes.length) return lookup(name, scopes[cell].root, Infinity, cell + 1, depth + 1);
    if (catalog.names.has('builtins.' + name)) return 'builtins.' + name;
    return keywords.has(name) ? 'Python: ' + keywords.get(name) : null;
  }
  function expression(expr, scope, row, cell, depth) {
    let simplified = expr.trim(),
      old;
    do {
      old = simplified;
      simplified = simplified.replace(/\([^()]*\)/g, '@');
    } while (old !== simplified);
    if (!/^\w+(?:@?\s*\.\s*\w+)*@?$/.test(simplified)) return null;
    const parts = simplified.replace(/\s/g, '').split('.');
    let value;
    for (const [i, part] of parts.entries()) {
      const call = part.endsWith('@'),
        name = call ? part.slice(0, -1) : part;
      value = i === 0 ? lookup(name, scope, row, cell, depth) : value + '.' + name;
      if (call) value = returnType(value);
      if (!value) return null;
    }
    return value;
  }
  const name = expression(token.expr, current.scopes[pos.line], pos.line, 0, 0);
  return (name && catalog.names.get(name)) || null;
}

function fromDefinition(uri, leaf, catalog) {
  const m = /(?:^|\/)(?:site-packages|dist-packages)\/([\w]+)\/(.*)\.pyi?$/.exec(
    uri.replace(/\\/g, '/')
  );
  if (!m || !leaf) return null;
  const module = [m[1], ...m[2].split('/').filter((x) => x !== '__init__')].join('.');
  const direct = catalog.names.get(module + '.' + leaf);
  if (direct) return direct;
  if (/^numpy\._?core\.multiarray$/.test(module) && leaf === 'where')
    return catalog.names.get('numpy.where') || null;
  // Private implementation modules often implement several public methods with the same name.
  const matches = catalog.entries.filter((e) => e.pack.id === m[1] && e.name.split('.').pop() === leaf);
  return matches.length === 1 ? matches[0] : null;
}
module.exports = { analyze, resolve, symbolAt, fromDefinition };
