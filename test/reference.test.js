'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path');
const { Catalog } = require('../reference/catalog');
const {
  resolve,
  fromDefinition,
  analyze,
  keywordCall,
  cellStart
} = require('../reference/python-symbols');
const { formatEntry } = require('../reference/format');
let c;
test.before(async () => {
  c = await Catalog.load(path.join(__dirname, '../reference/data'));
});
function document(text) {
  return { version: 1, getText: () => text };
}
function at(source, prior = []) {
  const offset = source.indexOf('|'),
    prefix = source.slice(0, offset).split('\n');
  assert.notEqual(offset, -1);
  return resolve(
    document(source.replace('|', '')),
    { line: prefix.length - 1, character: prefix.at(-1).length },
    c,
    prior.map(document)
  )?.name;
}
test('aliases, submodules, from imports and cursor component', () => {
  assert.equal(at('import numpy as n\nn.wh|ere(x)'), 'numpy.where');
  assert.equal(at('from numpy import where as pick\npi|ck(x)'), 'numpy.where');
  assert.equal(
    at('from sklearn.model_selection import (\n train_test_split as split,\n)\nspli|t(x)'),
    'sklearn.model_selection.train_test_split'
  );
  assert.equal(at('import scipy.stats\nscipy.stats.tte|st_ind(a,b)'), 'scipy.stats.ttest_ind');
  assert.equal(at('import numpy as np\nnp.where|(ok)'), 'numpy.where');
  assert.equal(at('import numpy as np\nnp.li|nalg.solve(a,b)'), 'numpy.linalg');
});
test('receiver provenance, chains, annotations and preceding notebook cells', () => {
  assert.equal(
    at('from sklearn.linear_model import LinearRegression as LR\nreg=LR()\nreg.fi|t(X,y)'),
    'sklearn.linear_model.LinearRegression.fit'
  );
  assert.equal(
    at("import pandas as pd\ndf=pd.read_csv('data.csv')\ndf.groupby('x').me|an()"),
    'pandas.api.typing.DataFrameGroupBy.mean'
  );
  assert.equal(
    at(
      'from sklearn.linear_model import LinearRegression as LR\nmodel=LR().fit(X,y)\nmodel.pre|dict(X)'
    ),
    'sklearn.linear_model.LinearRegression.predict'
  );
  assert.equal(
    at('import matplotlib.pyplot as plt\nfig, ax=plt.subplots()\nax.pl|ot(x,y)'),
    'matplotlib.axes.Axes.plot'
  );
  assert.equal(
    at('df.gr|oupby(x)', ['import pandas as pd', 'df = pd.DataFrame()']),
    'pandas.DataFrame.groupby'
  );
  assert.equal(
    at('import pandas as pd\ndef f(x: pd.Series):\n    return x.me|an()'),
    'pandas.Series.mean'
  );
  assert.equal(at('import seaborn as sns\nsns.heat|map(x)'), 'seaborn.heatmap');
});
test('comments, strings, unsupported receivers and local names defer to the editor', () => {
  for (const s of [
    '# np.wh|ere()',
    '"""\nimport numpy as np\nnp.wh|ere(x)\n"""',
    'import numpy as np\nx="np.wh|ere()"',
    'model.fi|t(X,y)',
    'def where(x):\n    pass\nwh|ere(y)',
    'import numpy as np\nnp = something_else()\nnp.wh|ere(x)',
    'import numpy as np\ndef f(np):\n    return np.wh|ere(x)'
  ])
    assert.equal(at(s), undefined, s);
  assert.equal(at('le|n(x)'), 'builtins.len');
  assert.equal(at('i|f x:\n    pass'), 'Python: if');
});
test('definition fallback only accepts unambiguous installed symbols', () => {
  assert.equal(
    fromDefinition('/p/site-packages/numpy/_core/multiarray.py', 'where', c)?.name,
    'numpy.where'
  );
  assert.equal(fromDefinition('/project/numpy/multiarray.py', 'where', c), null);
  assert.equal(fromDefinition('/p/site-packages/sklearn/base.py', 'fit', c), null);
});
test('offline search, signatures, bodies and environment-independent counts', async () => {
  assert.equal(c.entries.length, 35094);
  for (const [query, expected] of [
    ['np.where', 'numpy.where'],
    ['df.groupby', 'pandas.DataFrame.groupby'],
    ['sns.heatmap', 'seaborn.heatmap'],
    ['train_test_split', 'sklearn.model_selection.train_test_split']
  ])
    assert.equal(c.search(query).entries[0].name, expected);
  assert.match(c.names.get('numpy.where').sig, /condition/);
  assert.match(await c.body('numpy.where'), /Examples/);
  assert.match(c.names.get('sklearn.metrics.ConfusionMatrixDisplay.plot').sig, /xticks_rotation/);
  assert.match(await c.body('sklearn.metrics.ConfusionMatrixDisplay.plot'), /vertical/);
});

test('notebooks find the closest preceding binding even fifty cells back', () => {
  const cells = ['import numpy as lib', ...Array(50).fill('pass')];
  assert.equal(at('lib.wh|ere(x)', cells), 'numpy.where');
  assert.equal(at('lib.wh|ere(x)', [...cells, 'lib = other()']), undefined);
  assert.equal(at('le|n(x)', cells), 'builtins.len');
  const doc = document('# Notes\n\nresult = np.where(mask, a, b)');
  assert.deepEqual(cellStart(doc), { line: 2, character: 12 });
});

test('named arguments identify their innermost call across lines', () => {
  const code = 'coefplot.plot(\n  cmap=choose("x,y", options=[1,2]),\n  xticks_rotation="vertical"\n)';
  const lines = analyze(document(code)).lines;
  assert.deepEqual(keywordCall(lines, { line: 2, character: 8 }), {
    parameter: 'xticks_rotation',
    position: { line: 0, character: 9 }
  });
  assert.deepEqual(keywordCall(lines, { line: 1, character: 23 }), {
    parameter: 'options',
    position: { line: 1, character: 7 }
  });
  for (const text of ['n = 4', 'plot(x == 3)', 'def func(key=4):', 'f("key=3")', 'f(a, # key=2)']) {
    const line = analyze(document(text)).lines;
    assert.equal(
      keywordCall(line, { line: 0, character: Math.max(0, text.search(/(?:key|x|n) ?=/)) }),
      null,
      text
    );
  }
});

test('documentation distinguishes the owning class, method and attribute', async () => {
  for (const [name, owner, kind] of [
    ['sklearn.metrics.ConfusionMatrixDisplay.plot', 'sklearn.metrics.ConfusionMatrixDisplay', 'Method'],
    ['numpy.ndarray.shape', 'numpy.ndarray', 'Attribute'],
    ['pandas.Series.str.contains', 'pandas.Series', 'Method'],
    ['torch.nn.Linear', undefined, 'Class']
  ]) {
    const page = formatEntry(c.names.get(name), await c.body(name), c);
    assert.equal(page.owner, owner);
    assert.ok(page.html.includes('class="ref-kind">' + kind + '<'));
  }
  const e = c.names.get('sklearn.metrics.ConfusionMatrixDisplay.plot');
  const html = formatEntry(e, await c.body(e.name), c).html;
  assert.match(html, /data-param-jump="xticks_rotation"/);
  assert.match(html, /data-params="xticks_rotation"/);
  assert.match(html, /data-section-jump="\d+">Examples</);
});

test('parameter groups, Google-style arguments and literal HTML survive rendering', () => {
  const e = { ...c.names.get('numpy.where'), sig: 'np.where(x, y, flag=True)' };
  const body =
    'Parameters\n----------\nx, y : array_like\n    Inputs <unsafe>.\nArgs:\n    flag (bool): Whether to use `x`.\n    path: Path to <file>.\nReturns:\n    Value.\nNotes\n-----\n<script>escape()</script>';
  const html = formatEntry(e, body, c).html;
  assert.match(html, /data-params="x y"/);
  assert.match(html, /<span class="ref-type">array_like<\/span>/);
  assert.match(html, /<dd>Whether to use <code>x<\/code>\.<\/dd>/);
  assert.match(html, /<dd>Path to &lt;file&gt;\.<\/dd>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('workspace indexes from 0.2 inherit kinds without rebuilding', async (t) => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const { gzipSync } = require('node:zlib');
  const local = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-view-legacy-'));
  t.after(() => fs.rm(local, { recursive: true, force: true }));
  const pack = {
    id: 'numpy',
    label: 'NumPy',
    version: 'old-local',
    kind: 'docstrings',
    chunk: 64,
    count: 2
  };
  await fs.writeFile(path.join(local, 'catalog.json'), JSON.stringify({ schema: 1, packs: [pack] }));
  const rows = [
    ['numpy.ndarray.shape', 'arr.shape', 'Shape.', 0, '', null],
    ['numpy.old_name', '', 'Old symbol.', 1, '', null]
  ];
  await fs.writeFile(path.join(local, 'numpy.index.gz'), gzipSync(JSON.stringify(rows)));
  const catalog = await Catalog.load(path.join(__dirname, '../reference/data'), local);
  assert.equal(catalog.names.get('numpy.ndarray.shape').kind, 'attribute');
  assert.equal(catalog.names.get('numpy.ndarray.shape').pack.version, 'old-local');
  assert.equal(catalog.names.get('numpy.old_name').kind, 'symbol');
});
