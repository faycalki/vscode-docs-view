# Docs View with Offline Python Reference

Click a Python function and read its signature, parameters, and examples in the **Documentation** view. For example, click `where` in `np.where(mask, a, b)`. This fork of Matt Bierner’s Docs View bundles library references so that the panel can answer even when a Python language server returns an empty hover.

## Install

1. Download [docs-view-0.2.0.vsix](https://github.com/faycalki/vscode-docs-view/raw/refs/heads/master/downloads/docs-view-0.2.0.vsix).
2. If you use the original **Docs View** by bierner, disable it first. Both extensions contribute the same view and commands.
3. In VS Code, run **Extensions: Install from VSIX…** from the Command Palette and choose the file. Or run `code --install-extension ~/Downloads/docs-view-0.2.0.vsix`.
4. Run **View: Open View… → Documentation** once. Drag the view to the secondary sidebar or bottom panel if you want more room.

## While coding

| Action | Result |
| --- | --- |
| Click a name or move the caret onto it | The panel shows the matched reference, including the package version. When available, the editor’s own hover appears below it. |
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

Cursor lookup follows explicit imports, aliases, direct constructors, and common factories. Python notebook cells can use imports in preceding cells, in document order. For dynamic or ambiguous expressions it asks the editor for a definition or shows the ordinary hover. Search also works when the symbol has not been imported. A saved Obsidian link such as `vscode://faycalki.docs-view/search?q=np.where` opens the same search.

## Original Docs View behavior

All languages with a VS Code hover provider can display their normal syntax-highlighted Markdown. The upstream `docsView.documentationView.updateMode` setting supports `live` (follow the cursor, including empty positions) and `sticky` (keep the last available documentation). Turn off `docsView.pythonReference.enabled` to use ordinary hovers for cursor lookups.

## Build

Use Node.js 20.19+ or 22.12+, npm, and Python 3.10+. From the repository root:

```sh
npm ci --ignore-scripts
npm test
npm run vscode:prepublish
npx @vscode/vsce@3.6.2 package --out downloads/docs-view-0.2.0.vsix
```

The build expands `reference/bundled.zip` into individually compressed files. The extension reads an index once, then loads documentation bodies on demand. The source [indexer](reference/scripts/build_index.py) lists the covered modules. Package licenses are in [reference/licenses](reference/licenses). The original extension is available at [mattbierner/vscode-docs-view](https://github.com/mattbierner/vscode-docs-view).
