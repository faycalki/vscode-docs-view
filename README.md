# Docs View with Offline Python Reference

Click a Python function and read its signature, parameters, and examples in the **Documentation** view. For example, click `where` in `np.where(mask, a, b)`. This fork of Matt Bierner’s Docs View bundles library references so that the panel can answer even when a Python language server returns an empty hover.

## Install

1. After the first Marketplace release, install **Docs View with Offline Python Reference** by `faycalki` in VS Code, or run `code --install-extension faycalki.docs-view`. For a manual install, extract the VSIX from the release kit. The [original 0.3.0 installer](https://github.com/faycalki/vscode-docs-view/raw/refs/heads/master/downloads/docs-view-0.3.0.vsix) is also available.
2. If you use the original **Docs View** by bierner, disable it first. Both extensions contribute the same view and commands.
3. For a manual install, run **Extensions: Install from VSIX…** from the Command Palette and choose the extracted VSIX.
4. Reload VS Code if prompted. **Documentation** opens at startup and reopens when you return to a file or notebook cell. You can keep typing while it opens. Drag the view to the secondary sidebar or bottom panel if you prefer more width.

## While coding

| Action | Result |
| --- | --- |
| Click a name or move the caret onto it | The heading shows the symbol kind, its owner, and the selected member. For `frame.groupby`, click **DataFrame** to read the class and **← Back to member** to return. The usual editor hover is available below. |
| Click a keyword argument in your code | In `coefplot.plot(xticks_rotation="vertical")`, clicking `xticks_rotation` opens its parameter description. You can also click a documented parameter in the signature or jump directly to **Returns** or **Examples**. |
| Press **Ctrl+Alt+J** (**Cmd+Alt+J** on macOS) or click the magnifier | Search across libraries. Try `np.where`, `df.groupby`, `train_test_split`, `xticks_rotation`, or `list comprehension`. Use ↑/↓ to select, Tab to complete a name, and Enter to read it. |
| Click the pin in the view title | Hold the current page while moving around the editor. Unpin to resume. |
| Run **Docs View: Index Python Environment** | In a trusted workspace, choose a Python 3.10+ executable, including a conda or virtualenv interpreter. Its installed versions replace the corresponding bundled references for this workspace. |
| Run **Docs View: Use Bundled Python Reference** | Return to the shipped snapshot. |

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

Cursor lookup follows explicit imports, aliases, direct constructors, and common factories. In Jupyter `.ipynb` notebooks, click a symbol while editing or navigate between code cells. In cell navigation mode the view uses the last caret position for that cell, or the first call or symbol when visiting a cell for the first time. Imports and assignments in preceding Python cells are resolved in document order. Edits or moves to those cells update the reference. You can look things up before running a kernel. For dynamic or ambiguous expressions it asks the editor for a definition or shows the ordinary hover. Search also works when the symbol has not been imported. A saved Obsidian link such as `vscode://faycalki.docs-view/search?q=np.where` opens the same search.

## Original Docs View behavior

Set `docsView.documentationView.autoOpen` to `false` if you prefer to open the view yourself.

All languages with a VS Code hover provider can display their normal syntax-highlighted Markdown. The upstream `docsView.documentationView.updateMode` setting supports `live` (follow the cursor, including empty positions) and `sticky` (keep the last available documentation). Turn off `docsView.pythonReference.enabled` to use ordinary hovers for cursor lookups.

## Build

Use Node.js 24 LTS, npm, and Python 3.10+ in the repository root.

```sh
npm ci --ignore-scripts
npm test
npm run release:zip
```

The VSIX is written to the repository root and the complete release kit to `release/`. The [publishing guide](https://github.com/faycalki/vscode-docs-view/blob/master/PUBLISHING.md) covers first-time Marketplace setup and automatic patch releases.

The build expands `reference/bundled.zip` into individually compressed files. The extension reads an index once, then loads documentation bodies on demand. The source [indexer](reference/scripts/build_index.py) lists the covered modules. Package licenses are in [reference/licenses](reference/licenses). The original extension is available at [mattbierner/vscode-docs-view](https://github.com/mattbierner/vscode-docs-view).
