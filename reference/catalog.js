'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {promisify} = require('node:util');
const gunzip = promisify(require('node:zlib').gunzip);

const ALIAS = new Map(Object.entries({
  np: 'numpy', pd: 'pandas', df: 'pandas.dataframe', s: 'pandas.series', ser: 'pandas.series',
  arr: 'numpy.ndarray', ndarray: 'numpy.ndarray', rng: 'numpy.random.generator',
  sns: 'seaborn', so: 'seaborn.objects', plt: 'matplotlib.pyplot', mpl: 'matplotlib',
  ax: 'matplotlib.axes.axes', fig: 'matplotlib.figure.figure', sp: 'scipy', stats: 'scipy.stats',
  nn: 'torch.nn', f: 'torch.nn.functional', tensor: 'torch.tensor', optim: 'torch.optim',
  display: 'sklearn.metrics.confusionmatrixdisplay', 'scikit-learn': 'sklearn',
  pytorch: 'torch', py: 'python'
}));
const START = [
  'numpy.reshape', 'pandas.DataFrame.groupby', 'sklearn.model_selection.cross_val_score',
  'seaborn.heatmap', 'scipy.stats.ttest_ind', 'matplotlib.pyplot.subplots',
  'Python: list comprehension', 'torch.nn.Linear'
];
const POPULAR = new Set([...START, 'numpy.array', 'numpy.where', 'pandas.read_csv',
  'pandas.DataFrame', 'pandas.Series', 'numpy.ndarray', 'sklearn.metrics.f1_score',
  'sklearn.model_selection.StratifiedKFold', 'sklearn.metrics.ConfusionMatrixDisplay.plot',
  'sklearn.model_selection.train_test_split', 'scipy.stats.norm', 'torch.tensor',
  'builtins.range', 'builtins.enumerate', 'builtins.zip']);
const BASES = {
  python: 'https://docs.python.org/3/search.html', numpy: 'https://numpy.org/doc/stable/search.html',
  pandas: 'https://pandas.pydata.org/docs/search.html', scipy: 'https://docs.scipy.org/doc/scipy/reference/search.html',
  sklearn: 'https://scikit-learn.org/stable/search.html', seaborn: 'https://seaborn.pydata.org/search.html',
  matplotlib: 'https://matplotlib.org/stable/search.html', torch: 'https://docs.pytorch.org/docs/stable/search.html'
};

const squeeze = s => s.replace(/[^a-z0-9]+/g, '');
const words = s => s.replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function seedAt(line, column) {
  for (const item of line.matchAll(/[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/g)) {
    if (item.index <= column && column <= item.index + item[0].length) return item[0];
  }
  return '';
}

function queryParts(input) {
  const raw = String(input || '').trim().slice(0, 180);
  const text = raw.toLowerCase()
    .replace(/^(df|s|ser)\.groupby(?:\([^)]*\))?\./, (_, receiver) =>
      receiver === 'df' ? 'pandas.api.typing.dataframegroupby.' : 'pandas.api.typing.seriesgroupby.')
    .replace(/^([a-z_]\w*(?:\.[a-z_]\w*)*)\s*[\[(].*$/, '$1');
  const [head, ...rest] = text.split('.');
  const qualified = rest.length > 0;
  const translated = ALIAS.get(head);
  const full = qualified ? [translated || head, ...rest].join('.') : text;
  const pack = (translated || head).split('.')[0];
  const scoped = qualified && Object.hasOwn(BASES, pack) ? pack : null;
  return {raw, text, full, qualified, scoped, tokens: words(text).split(' ').filter(Boolean),
    compact: squeeze(text), suffix: rest.join('.'), head};
}

function subsequence(needle, haystack) {
  if (needle.length < 3 || needle.length > haystack.length) return 0;
  let last = -1, first = -1;
  for (const c of needle) {
    last = haystack.indexOf(c, last + 1);
    if (last < 0) return 0;
    if (first < 0) first = last;
  }
  const spread = last - first + 1 - needle.length;
  return spread <= Math.max(4, needle.length) ? 230 - spread * 3 - first : 0;
}

function prepare(row, pack) {
  const [name, sig, summary, doc, tags, link] = row;
  const topic = name.startsWith('Python: ');
  const key = topic ? name.slice(8).toLowerCase() : name.toLowerCase()
    .replace(/^pandas\.core\.groupby\.generic\.(dataframegroupby|seriesgroupby)\./, 'pandas.api.typing.$1.');
  const leaf = topic ? key : key.split('.').pop();
  const cleanName = words(topic ? name.slice(8) : name);
  const compactLeaf = squeeze(leaf);
  return {name, sig, summary, doc, tags: (tags || '').toLowerCase(), link, pack, key, leaf, cleanName,
    compactLeaf, compactName: squeeze(key), extra: (summary + ' ' + sig).toLowerCase(),
    priority: (POPULAR.has(name) ? 20 : 0) + (key.startsWith('builtins.') ? 7 : 0)
      - Math.min(6, key.split('.').length), topic};
}

function score(e, q) {
  if (q.scoped && e.pack.id !== q.scoped) return 0;
  if (e.name === q.raw) return 1050;
  if (e.key === q.full || e.leaf === q.text) return 1000;
  if (!q.qualified && ALIAS.has(q.text)) {
    const prefix = ALIAS.get(q.text);
    if (e.key === prefix) return 995;
    if (e.key.startsWith(prefix + '.')) return 740 - Math.min(80, e.key.length - prefix.length);
  }
  if (q.qualified) {
    if (e.key.endsWith('.' + q.full)) return 960;
    if (e.key.startsWith(q.full)) return 855 - Math.min(100, e.key.length - q.full.length);
    if (e.key.includes('.' + q.full)) return 790;
    // Allow library + short symbol even if the package normally exports it in a submodule.
    if (q.scoped && q.head !== 'df' && q.suffix && !q.suffix.includes('.') && e.leaf === q.suffix) return 730;
    if (q.scoped && q.suffix && e.leaf.startsWith(q.suffix) && q.full.split('.').length === 2) return 630;
    return 0;
  }
  if (/[^a-z0-9\s]/.test(q.text) && e.topic && e.tags.split(' ').includes(q.text)) return 955;
  if (!q.compact) return 0;
  if (e.compactLeaf === q.compact) return 965;
  if (e.tags && e.tags === q.text) return 925;
  if (e.leaf.startsWith(q.text)) return 870 - Math.min(90, e.leaf.length - q.text.length);
  if (e.compactLeaf.startsWith(q.compact)) return 840 - Math.min(90, e.compactLeaf.length - q.compact.length);
  if (e.tags && (' ' + e.tags + ' ').includes(' ' + q.text + ' ')) return 815;
  if (e.compactLeaf.includes(q.compact)) return 730;
  if (e.compactName.includes(q.compact)) return 655;
  if (q.tokens.length > 1 && q.tokens.every(t => e.cleanName.includes(t) || e.tags.includes(t))) return 600;
  if (q.text.length > 2 && e.extra.includes(q.text)) return 330;
  if (q.tokens.length > 1 && q.tokens.every(t => e.cleanName.includes(t) || e.tags.includes(t) || e.extra.includes(t))) return 300;
  return subsequence(q.compact, e.compactLeaf);
}

async function unzipJSON(file) {
  return JSON.parse((await gunzip(await fs.readFile(file))).toString('utf8'));
}

async function readPacks(root, local = false) {
  const data = JSON.parse(await fs.readFile(path.join(root, 'catalog.json'), 'utf8'));
  if (data.schema !== 1 || !Array.isArray(data.packs)) throw new Error('Unsupported reference catalog.');
  return data.packs.filter(p => Object.hasOwn(BASES, p.id)).map(p => ({...p, root, local}));
}

class Catalog {
  constructor(packs, entries) {
    this.packs = packs;
    this.entries = entries.flat();
    this.names = new Map(this.entries.map(entry => [entry.name, entry]));
    this.chunks = new Map();
  }
  static async load(bundled, overlay) {
    const packs = new Map((await readPacks(bundled)).map(p => [p.id, p]));
    if (overlay) for (const p of await readPacks(overlay, true)) packs.set(p.id, p);
    const selected = [...packs.values()];
    const entries = await Promise.all(selected.map(async p => {
      const rows = await unzipJSON(path.join(p.root, p.id + '.index.gz'));
      if (rows.length !== p.count) throw new Error('Incomplete index for ' + p.label + '.');
      return rows.map(row => prepare(row, p));
    }));
    return new Catalog(selected, entries);
  }
  search(input, group = '', recent = [], limit = 45) {
    const q = queryParts(input);
    if (!q.text) {
      const choices = [...new Set([...recent, ...START])].map(n => this.names.get(n))
        .filter(e => e && (!group || e.pack.id === group));
      if (group && choices.length < 5) {
        const seen = new Set(choices);
        for (const e of this.entries) {
          if (e.pack.id === group && !seen.has(e)) choices.push(e);
          if (choices.length >= 12) break;
        }
      }
      return {total: choices.length, entries: choices.slice(0, limit)};
    }
    const candidates = [];
    for (const e of this.entries) {
      if (group && e.pack.id !== group) continue;
      const value = score(e, q);
      if (value) candidates.push([value + e.priority, e]);
    }
    candidates.sort((a, b) => b[0] - a[0] || a[1].key.length - b[1].key.length || a[1].name.localeCompare(b[1].name));
    return {total: candidates.length, entries: candidates.slice(0, limit).map(pair => pair[1])};
  }
  publicEntry(e) {
    return {name: e.name, sig: e.sig, summary: e.summary, label: e.pack.label, version: e.pack.version,
      origin: e.pack.local ? 'Your interpreter' : e.pack.kind === 'starter' ? 'Starter cards' : 'Bundled'};
  }
  async body(name) {
    const e = this.names.get(name);
    if (!e) return '';
    const {id, root, chunk} = e.pack;
    const key = id + '.doc.' + Math.floor(e.doc / chunk) + '.gz';
    if (!this.chunks.has(key)) {
      if (this.chunks.size >= 16) this.chunks.delete(this.chunks.keys().next().value);
      this.chunks.set(key, unzipJSON(path.join(root, key)).catch(err => { this.chunks.delete(key); throw err; }));
    }
    return (await this.chunks.get(key))[e.doc % chunk];
  }
  official(name) {
    const e = this.names.get(name);
    if (!e) return null;
    // Only these hand-checked starter links are direct URLs. Other entries search the project site.
    if (e.link && e.pack.kind === 'starter' && e.link.startsWith('https://docs.pytorch.org/docs/2.9/generated/')) return e.link;
    let base = BASES[e.pack.id];
    if (e.pack.id === 'python') base = base.replace('/3/', '/' + e.pack.version.split('.').slice(0, 2).join('.') + '/');
    const q = e.topic ? e.leaf : e.name.replace(/^builtins\./, '');
    return base + '?q=' + encodeURIComponent(q);
  }
}

module.exports = {Catalog, readPacks, seedAt};
