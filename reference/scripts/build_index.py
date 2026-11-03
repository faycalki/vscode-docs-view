"""Export local API help without executing examples. Run with Python 3.10+ and -I."""
import argparse
import gzip
import importlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import platform
import re
import types
import warnings

# Only import known reference modules. Never walk a user's project or run its code.
MODULES = {
    "python": """builtins argparse array asyncio base64 bisect calendar cmath collections
        collections.abc concurrent.futures contextlib copy csv dataclasses datetime decimal
        enum functools fractions glob gzip hashlib heapq inspect io itertools json logging
        math multiprocessing operator os os.path pathlib pickle pprint queue random re
        shutil sqlite3 statistics string struct subprocess sys tempfile textwrap threading
        time timeit types typing unittest unittest.mock urllib.parse uuid warnings weakref
        xml.etree.ElementTree zipfile zoneinfo""",
    "numpy": """numpy numpy.char numpy.dtypes numpy.emath numpy.exceptions numpy.fft
        numpy.lib.format numpy.lib.recfunctions numpy.lib.stride_tricks numpy.linalg numpy.ma
        numpy.polynomial numpy.polynomial.polynomial numpy.polynomial.chebyshev
        numpy.polynomial.legendre numpy.random numpy.rec numpy.strings numpy.testing
        numpy.typing""",
    "pandas": """pandas pandas.api.types pandas.api.extensions pandas.api.indexers
        pandas.arrays pandas.errors pandas.offsets pandas.plotting pandas.testing
        pandas.tseries.frequencies pandas.tseries.offsets""",
    "sklearn": """sklearn sklearn.base sklearn.calibration sklearn.cluster sklearn.compose
        sklearn.covariance sklearn.cross_decomposition sklearn.datasets sklearn.decomposition
        sklearn.discriminant_analysis sklearn.dummy sklearn.ensemble sklearn.exceptions
        sklearn.feature_extraction sklearn.feature_extraction.image sklearn.feature_extraction.text
        sklearn.feature_selection sklearn.gaussian_process sklearn.gaussian_process.kernels
        sklearn.impute sklearn.inspection sklearn.isotonic sklearn.kernel_approximation
        sklearn.kernel_ridge sklearn.linear_model sklearn.manifold sklearn.metrics
        sklearn.metrics.cluster sklearn.metrics.pairwise sklearn.mixture sklearn.model_selection
        sklearn.multiclass sklearn.multioutput sklearn.naive_bayes sklearn.neighbors
        sklearn.neural_network sklearn.pipeline sklearn.preprocessing sklearn.random_projection
        sklearn.semi_supervised sklearn.svm sklearn.tree sklearn.utils sklearn.utils.class_weight
        sklearn.utils.extmath sklearn.utils.validation""",
    "scipy": """scipy scipy.cluster.hierarchy scipy.cluster.vq scipy.constants scipy.datasets
        scipy.differentiate scipy.fft scipy.fftpack scipy.integrate scipy.interpolate scipy.io
        scipy.io.wavfile scipy.linalg scipy.linalg.blas scipy.linalg.lapack scipy.ndimage
        scipy.odr scipy.optimize scipy.signal scipy.signal.windows scipy.sparse scipy.sparse.csgraph
        scipy.sparse.linalg scipy.spatial scipy.spatial.distance scipy.spatial.transform
        scipy.special scipy.stats scipy.stats.contingency scipy.stats.mstats scipy.stats.qmc""",
    "seaborn": "seaborn seaborn.objects",
    "matplotlib": """matplotlib matplotlib.pyplot matplotlib.axes matplotlib.figure matplotlib.artist
        matplotlib.animation matplotlib.cm matplotlib.colors matplotlib.collections matplotlib.dates
        matplotlib.gridspec matplotlib.image matplotlib.legend matplotlib.lines matplotlib.markers
        matplotlib.patches matplotlib.path matplotlib.projections matplotlib.scale matplotlib.style
        matplotlib.text matplotlib.ticker matplotlib.transforms matplotlib.tri""",
    "torch": """torch torch.nn torch.nn.functional torch.nn.init torch.nn.utils torch.optim
        torch.optim.lr_scheduler torch.autograd torch.cuda torch.fft torch.linalg torch.special
        torch.random torch.distributions torch.utils.data torch.utils.data.dataset torch.amp""",
}
LABELS = dict(python="Python", numpy="NumPy", pandas="pandas", sklearn="scikit-learn",
              scipy="SciPy", seaborn="seaborn", matplotlib="Matplotlib", torch="PyTorch")
DISPATCH = {
    "pandas.DataFrame.": "df.", "pandas.Series.": "s.", "numpy.ndarray.": "arr.",
    "numpy.random.Generator.": "rng.", "matplotlib.axes.Axes.": "ax.",
    "matplotlib.figure.Figure.": "fig.", "sklearn.metrics.ConfusionMatrixDisplay.": "display.",
    "torch.Tensor.": "tensor.",
    "pandas.api.typing.DataFrameGroupBy.": "df.groupby(...).",
    "pandas.api.typing.SeriesGroupBy.": "s.groupby(...).",
    "pandas.api.typing.Rolling.": "df.rolling(...).",
    "pandas.api.typing.Resampler.": "df.resample(...).",
}
PREFIX = {"builtins.": "", "numpy.": "np.", "pandas.": "pd.", "seaborn.": "sns.",
          "matplotlib.pyplot.": "plt.", "scipy.stats.": "stats.", "torch.nn.functional.": "F.",
          "torch.nn.": "nn."}
INDEXING = {"pandas.DataFrame.loc": "[rows, columns]", "pandas.DataFrame.iloc": "[rows, columns]",
            "pandas.DataFrame.at": "[row, column]", "pandas.DataFrame.iat": "[row, column]",
            "pandas.Series.loc": "[label]", "pandas.Series.iloc": "[position]",
            "pandas.Series.at": "[label]", "pandas.Series.iat": "[position]"}
SKIP = {"test", "tests", "testmod", "testfile", "Tester", "PytestTester", "bench"}
STDLIB_FOREIGN = {"posix", "nt", "posixpath", "ntpath", "genericpath", "_io", "_datetime",
                  "_collections", "_functools", "_operator", "_stat", "_thread", "_sqlite3"}
STARTER = Path(__file__).with_name("cards.json")
CHUNK = 64


def packed(path, value):
    raw = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
    path.write_bytes(gzip.compress(raw, compresslevel=6, mtime=0))


def call_name(name):
    for prefix, alias in {**DISPATCH, **PREFIX}.items():
        if name.startswith(prefix):
            return alias + name[len(prefix):]
    return name


def strip_head(doc):
    lines = doc.splitlines()
    while lines and (not lines[0].strip() or re.match(r"^(?:[\w.]+\(|[=-]{3,}$)", lines[0])):
        lines.pop(0)
    return " ".join(" ".join("\n".join(lines).partition("\n\n")[0].splitlines()).split())[:210]


def header_signatures(doc, leaf, display):
    lines = doc.splitlines()
    found = []
    # Many C methods and NumPy ufuncs only publish their real syntax in the doc header.
    pattern = re.compile(r"^(?:[\w.]+\.)?" + re.escape(leaf) + r"\s*(\(.*)")
    i = 0
    while i < min(7, len(lines)):
        match = pattern.match(lines[i].strip())
        if not match:
            break
        form = match[1]
        while form.count("(") > form.count(")") and i + 1 < min(9, len(lines)):
            i += 1
            form += " " + lines[i].strip()
        if ")" in form:
            found.append(display + form[:form.rfind(")") + 1])
        i += 1
    return "\n".join(found)


def signature(obj, name, doc):
    display = call_name(name)
    if name in INDEXING:
        return display + INDEXING[name]
    if not callable(obj):
        return display
    header = header_signatures(doc, name.split(".")[-1], display)
    try:
        sig = inspect.signature(obj)
        params = list(sig.parameters.values())
        if any(name.startswith(key) for key in DISPATCH) and params and params[0].name in {"self", "cls"}:
            params = params[1:]
        bare = sig.replace(parameters=[p.replace(annotation=inspect.Parameter.empty) for p in params],
                           return_annotation=inspect.Signature.empty)
        form = str(bare)
        if header and (form.startswith("(*args") or form.startswith("(*a,") or not params):
            return header
        form = re.sub(r" at 0x[0-9a-fA-F]+", "", form)
        return display + form
    except (TypeError, ValueError, AttributeError, RecursionError):
        return header or ""


def doctext(obj):
    try:
        return inspect.getdoc(obj) or ""
    except (AttributeError, TypeError, ValueError):
        return ""


def synopsis(doc):
    first = doc.partition("\n\n")[0]
    if len(first) < 400 and not re.match(r"^[\w.]+\(", first):
        return " ".join(first.split())[:210]
    return strip_head(doc)


class Pack:
    def __init__(self, key, usage):
        self.key = key
        self.usage = usage
        self.rows = {}
        self.docs = {}
        self.missing = []

    def add(self, name, sig, doc, summary=None, tags="", url=None, *, kind="symbol"):
        if not doc or not doc.strip() or not name or name in self.rows:
            return
        doc = doc.strip()
        if name in self.usage:
            doc += "\n\nQuick example\n-------------\n" + self.usage[name]
        # Store repeated inherited method docs once even if hundreds of estimators expose them.
        did = self.docs.setdefault(doc, len(self.docs))
        self.rows[name] = [name, sig, synopsis(doc) if summary is None else summary, did, tags, url, kind]

    def add_obj(self, name, obj, kind=None):
        doc = doctext(obj)
        if doc:
            try:
                form = signature(obj, name, doc)
            except (TypeError, ValueError, AttributeError, RuntimeError, RecursionError):
                form = ""
            if kind is None:
                if inspect.isclass(obj):
                    kind = "class"
                elif inspect.isroutine(obj) or type(obj).__name__ == "ufunc":
                    kind = "function"
                else:
                    kind = "callable" if callable(obj) else "attribute"
            self.add(name, form, doc, kind=kind)

    def members(self, cls, parent):
        for key in dir(cls):
            if key.startswith("_") or key in SKIP:
                continue
            try:
                raw = inspect.getattr_static(cls, key)
                if isinstance(raw, (classmethod, staticmethod)):
                    raw = getattr(cls, key)
                if inspect.isroutine(raw) or isinstance(raw, property) or inspect.isdatadescriptor(raw):
                    self.add_obj(parent + "." + key, raw, "method" if inspect.isroutine(raw) else "attribute")
            except (AttributeError, TypeError, ValueError, ImportError):
                continue

    def module(self, modname):
        try:
            try:
                mod = importlib.import_module(modname)
            except ModuleNotFoundError:
                parent, sep, alias = modname.rpartition(".")
                if not sep:
                    raise
                mod = getattr(importlib.import_module(parent), alias)
        except (ImportError, AttributeError, OSError, RuntimeError) as exc:
            self.missing.append(f"{modname} ({type(exc).__name__})")
            return
        self.add(modname, modname, doctext(mod), kind="module")
        exports = getattr(mod, "__all__", None)
        for key in sorted(exports if exports is not None else vars(mod)):
            if key.startswith("_") or key in SKIP:
                continue
            try:
                obj = getattr(mod, key)
                if isinstance(obj, types.ModuleType):
                    continue
                origin = getattr(obj, "__module__", "") or ""
                if exports is None and self.key != "python":
                    namespace = self.key if modname == "seaborn.objects" or self.key == "torch" else mod.__name__
                    if not (origin == namespace or origin.startswith(namespace + ".")):
                        continue
                if self.key == "python" and exports is None and modname != "builtins":
                    if origin and not (origin.startswith(modname.split(".")[0]) or origin in STDLIB_FOREIGN or origin.startswith("_" + modname.split(".")[0])):
                        continue
                if not (callable(obj) or isinstance(obj, property)):
                    continue
                name = modname + "." + key
                self.add_obj(name, obj)
                if inspect.isclass(obj):
                    self.members(obj, name)
                elif self.key == "scipy" and modname == "scipy.stats" and hasattr(obj, "rvs") and hasattr(obj, "cdf"):
                    for method, form in re.findall(r"^\s*([a-z]+)(\([^\n]*\))\s*$", doctext(obj), re.M):
                        if hasattr(obj, method):
                            symbol = name + "." + method
                            self.add(symbol, call_name(symbol) + form, doctext(getattr(obj, method)), kind="method")
                elif self.key == "numpy" and type(obj).__name__ == "ufunc":
                    for method in ("reduce", "accumulate", "outer", "reduceat", "at"):
                        self.add_obj(name + "." + method, getattr(obj, method), "method")
            except (TypeError, AttributeError, ValueError, RuntimeError, ImportError, OSError, RecursionError):
                continue

    def write(self, root, version, kind="docstrings"):
        rows = sorted(self.rows.values(), key=lambda a: a[0].lower())
        packed(root / (self.key + ".index.gz"), rows)
        bodies = list(self.docs)
        for i in range(0, len(bodies), CHUNK):
            packed(root / f"{self.key}.doc.{i // CHUNK}.gz", bodies[i:i + CHUNK])
        return dict(id=self.key, label=LABELS[self.key], version=version, count=len(rows),
                    kind=kind, chunk=CHUNK, skippedModules=self.missing)


def pandas_extras(pack):
    # Accessor classes expose their methods without the need for data or user code.
    import pandas as pd
    accessors = [("pandas.Series.str", pd.Series, "str"), ("pandas.Series.dt", pd.Series, "dt"),
                 ("pandas.Series.cat", pd.Series, "cat"), ("pandas.DataFrame.plot", pd.DataFrame, "plot"),
                 ("pandas.Series.plot", pd.Series, "plot")]
    for name, cls, attr in accessors:
        try:
            api = getattr(cls, attr)
            if inspect.isclass(api):
                pack.add_obj(name, api, "accessor")
                pack.members(api, name)
        except (AttributeError, ImportError, TypeError):
            pass
    for mod, key, public in [
        ("pandas.core.groupby.generic", "DataFrameGroupBy", "pandas.api.typing.DataFrameGroupBy"),
        ("pandas.core.groupby.generic", "SeriesGroupBy", "pandas.api.typing.SeriesGroupBy"),
        ("pandas.core.window.rolling", "Rolling", "pandas.api.typing.Rolling"),
        ("pandas.core.resample", "Resampler", "pandas.api.typing.Resampler"),
    ]:
        try:
            obj = getattr(importlib.import_module(mod), key)
            api_typing = getattr(pd.api, "typing", None)
            actual = public if getattr(api_typing, key, None) is obj else obj.__module__ + "." + key
            pack.members(obj, actual)
        except (ImportError, AttributeError):
            pass


def language(pack, cards):
    try:
        from pydoc_data.topics import topics
    except ImportError:
        topics = {}
    used = set()
    for title, form, blurb, example, topic, tags in cards["python"]:
        key = "Python: " + title
        used.add(topic)
        body = blurb + "\n\nExamples\n--------\n" + example
        if topic and topic in topics:
            body += "\n\nLanguage reference\n------------------\n" + topics[topic]
        pack.add(key, form, body, blurb, tags, kind="syntax")
    for topic, body in topics.items():
        if topic in used:
            continue
        name = body.splitlines()[0].strip()
        pack.add("Python: " + name, "", body, name, topic.replace("-", " "), kind="syntax")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--bundled", action="store_true")
    parser.add_argument("--only", nargs="+", choices=tuple(MODULES))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    warnings.simplefilter("ignore")
    os.environ.setdefault("MPLBACKEND", "Agg")
    cards = json.loads(STARTER.read_text(encoding="utf-8"))
    manifest = {"schema": 1, "packs": [], "unavailable": []}
    for key in args.only or MODULES:
        pack = Pack(key, cards["usage"])
        try:
            if key == "python":
                version = platform.python_version()
            else:
                version = importlib.metadata.version("scikit-learn" if key == "sklearn" else key)
                importlib.import_module(key)
        except (ImportError, OSError, AttributeError, RuntimeError, ValueError) as exc:
            manifest["unavailable"].append(key)
            if key == "torch" and args.bundled:
                for name, form, blurb, example in cards["torch"]:
                    doc = blurb + "\n\nExamples\n--------\n" + example
                    kind = "method" if name.startswith("torch.Tensor.") else "function"
                    if name.rsplit(".", 1)[-1][0].isupper() or name == "torch.no_grad":
                        kind = "class"
                    pack.add(name, form, doc, blurb, "", f"https://docs.pytorch.org/docs/2.9/generated/{name}.html", kind=kind)
                manifest["packs"].append(pack.write(args.out, "2.9", "starter"))
            print(f"Skipped {LABELS[key]} ({type(exc).__name__}).", flush=True)
            continue
        if key == "python":
            language(pack, cards)
        for module in MODULES[key].split():
            pack.module(module)
        if key == "pandas":
            pandas_extras(pack)
        for name, (form, blurb, example, tags) in cards["constants"].items():
            lib, attr = name.split(".")
            if lib == key and hasattr(importlib.import_module(lib), attr):
                pack.add(name, form, blurb + "\n\nExamples\n--------\n" + example, blurb, tags, kind="constant")
        for name, tags in cards["keywords"].items():
            if name in pack.rows:
                pack.rows[name][4] = tags
        if pack.rows:
            manifest["packs"].append(pack.write(args.out, version))
            print(f"{LABELS[key]} {version}: {len(pack.rows):,} entries.", flush=True)
    if not manifest["packs"]:
        raise SystemExit("Could not index any reference modules.")
    (args.out / "catalog.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
