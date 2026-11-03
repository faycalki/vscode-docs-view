'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path');
const { Catalog } = require('../reference/catalog');
const { resolve, fromDefinition } = require('../reference/python-symbols');
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
