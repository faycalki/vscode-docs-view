# Python Syntax Shelf

Click a Python function and read its signature, parameters, and examples in the **Documentation** view. For example, click `where` in `np.where(mask, a, b)`. This fork of Matt Bierner’s Docs View bundles library references so that the panel can answer even when a Python language server returns an empty hover.

## Install

Install **Python Syntax Shelf** by `faycalki` from Extensions, or run `code --install-extension faycalki.python-syntax-shelf`. For a manual install, extract the release kit and choose the enclosed VSIX with **Extensions: Install from VSIX…**. [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=faycalki.python-syntax-shelf)

If you installed the earlier fork as `faycalki.docs-view` or `faycalki.docs-view-enhanced`, disable or uninstall that copy when switching. VS Code treats the new ID as a separate extension. Update any Obsidian search links to use the new ID.

**Documentation** opens automatically in files and notebooks. Drag it to the secondary sidebar or bottom panel if you prefer more width.

## While coding

| Action | Result |
| --- | --- |
| In **Cursor**, click a name or move the caret onto it | The heading shows the symbol kind, its owner, and the selected member. For `frame.groupby`, click **DataFrame** to read the class and **← Back to member** to return. The usual editor hover is available below. Blank lines, comments without documentation, and notebook cells without a result keep the last page visible. |
| Click a keyword argument in your code | In `coefplot.plot(xticks_rotation="vertical")`, clicking `xticks_rotation` opens its parameter description. You can also click a documented parameter in the signature or jump directly to **Returns** or **Examples**. |
| Press **Ctrl+Alt+J** (**Cmd+Alt+J** on macOS) or click the magnifier | Search across libraries. Try `np.where`, `df.groupby`, `train_test_split`, `xticks_rotation`, or `list comprehension`. Use ↑/↓ to select, Tab to complete a name, and Enter to open the result in **Search**. It stays there while you edit or change notebook cells. Select **Cursor** to resume following the editor, **Search** to revisit the result, or **New search…** to look up another symbol. |
| Click the pin in the view title | Hold the current **Cursor** page while moving around the editor. Unpin to resume. |
| Run **Python Syntax Shelf: Index Python Environment** | In a trusted workspace, choose a Python 3.10+ executable, including a conda or virtualenv interpreter. Its installed versions replace the corresponding bundled references for this workspace. |
| Run **Python Syntax Shelf: Use Bundled Python Reference** | Return to the shipped snapshot. |

```python
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

values = np.where(mask, a, b)  # Click where
frame = pd.read_csv("data.csv")
frame.groupby("label")        # Click groupby
model = LinearRegression()
model.fit(X, y)               # Click fit
```

The bundled catalog has 35,094 entries across Python 3.12, NumPy, pandas, SciPy, scikit-learn, seaborn, Matplotlib and 18 PyTorch starter entries. It contains API docstrings and syntax topics. Signatures and examples appear where the original package or a bundled syntax card provides them. Lookup is local after installation. Optional indexing imports supported packages in the interpreter you choose.

Cursor lookup follows explicit imports, aliases, direct constructors, and common factories. In Jupyter `.ipynb` notebooks, click a symbol while editing or navigate between code cells. In cell navigation mode the view uses the last caret position for that cell, or the first call or symbol when visiting a cell for the first time. Imports and assignments in preceding Python cells are resolved in document order. Edits or moves to those cells update the reference. You can look things up before running a kernel. For dynamic or ambiguous expressions it asks the editor for a definition or shows the ordinary hover. Search also works when the symbol has not been imported. A saved Obsidian link such as `vscode://faycalki.python-syntax-shelf/search?q=np.where` opens the same search.

## Settings

Set `pythonSyntaxShelf.documentationView.autoOpen` to `false` if you prefer to open the view yourself.

All languages with a VS Code hover provider can display their normal syntax-highlighted Markdown. Turn off `pythonSyntaxShelf.pythonReference.enabled` to use ordinary hovers for cursor lookups.

## Build

Use Node.js 24 LTS, npm, and Python 3.10+ in the repository root.

```sh
npm ci --ignore-scripts
npm test
npm run release:zip
```

The VSIX is written to the repository root and the complete release kit to `release/`. The [publishing guide](https://github.com/faycalki/vscode-docs-view/blob/master/PUBLISHING.md) covers first-time Marketplace setup and automatic patch releases.

The build expands `reference/bundled.zip` into individually compressed files. The extension reads an index once, then loads documentation bodies on demand. The source [indexer](reference/scripts/build_index.py) lists the covered modules. Package licenses are in [reference/licenses](reference/licenses). The original extension is available at [mattbierner/vscode-docs-view](https://github.com/mattbierner/vscode-docs-view).
