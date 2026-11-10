# Install or publish Python Syntax Shelf

## Install the enclosed extension

Extract the release kit into an empty folder. In VS Code, run **Extensions: Install from VSIX…** and select the enclosed `python-syntax-shelf-<version>.vsix`. On Fedora, you can also run these commands from the extracted folder.

```sh
sha256sum --check SHA256SUMS
code --install-extension ./python-syntax-shelf-*.vsix
```

For automatic Marketplace updates after publication, install the Marketplace copy with `code --install-extension faycalki.python-syntax-shelf --force` and enable extension auto-updates in VS Code.

## Connect GitHub to the Marketplace once

1. Sign in to [Manage publishers](https://marketplace.visualstudio.com/manage). Create or select the publisher whose **ID** is `faycalki`. The manifest identifies this extension as `faycalki.python-syntax-shelf`.
2. Under that publisher, open **Trusted Publishing**, select **Create**, and enter the following settings. The policy grants this GitHub workflow permission to publish.

   | Marketplace field | Value |
   | --- | --- |
   | Policy name | Python Syntax Shelf releases |
   | Repository owner | `faycalki` |
   | Repository | `vscode-docs-view` |
   | Workflow | `publish.yml` |
   | Environment | Leave empty |

3. Open the fork's [Actions tab](https://github.com/faycalki/vscode-docs-view/actions) and enable workflows if GitHub prompts you. Open [Package and publish](https://github.com/faycalki/vscode-docs-view/actions/workflows/publish.yml), choose **Run workflow**, select **master**, and run it once. The publishing job needs permission to create tags named `marketplace-v*`.
4. Check the **Publish the packaged VSIX** step, then open the [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=faycalki.python-syntax-shelf). The Marketplace can take a few minutes to make a new release visible.

Trusted Publishing uses a short-lived GitHub identity. All configuration for the repository is in `.github/workflows/publish.yml`. If setting up from this ZIP in a fresh clone, copy that file to the same path on `master` along with the build scripts. [Microsoft's publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)

## What happens on the next push

Before the first manual run, pushes to `master` build and test the kit. The first manual run reserves the version in `package.json`, then publishes. After that, a push changing the extension, bundled docs, README, or build files automatically tests, packages, and publishes the next patch. Changes confined to old downloads, design files, editor settings, or this guide skip the workflow.

The first version is **0.4.0** for this release line. The next two automatic patches are **0.4.1** and **0.4.2**. GitHub records each reservation in a `marketplace-v<version>` tag pointing to the source commit. It stamps the chosen version into both manifests in the kit without writing a version-bump commit to `master`. To start a new release line, set a higher version in the source manifest and lockfile, for example with `npm version minor --no-git-tag-version`, then commit and push.

The build uploads a downloadable **extension-release-kit** artifact. The publishing job verifies the enclosed VSIX's SHA-256 and sends those bytes to the Marketplace. If publication fails, correct the reported issue and rerun the failed job. A retry of the same commit reuses the same tag. An older run cannot supersede a newer reserved version.

If you already published a different build manually, set the source version above the latest Marketplace version before enabling automation.

## Build from this kit or a checkout

Use Node.js 24 LTS, npm, Git, and Python 3.10+ with `python3` on your path. Run the following from the folder containing `package.json`.

```sh
npm ci --ignore-scripts
npm test
npm run release:zip
```

`npm run package` builds just the installable VSIX in the current folder. `npm run release:zip` also produces `release/python-syntax-shelf-<version>-release-kit.zip` with the installer, checksum, source, offline reference snapshot, licenses, and workflow. The first dependency install requires network access. In a Git checkout, stage new source files before creating the kit. An extracted kit uses `SOURCE-FILES.txt` as its inventory.

For a manual Marketplace release, open the publisher dashboard and upload the enclosed **VSIX** using **New extension → Visual Studio Code**, or **Update** for an existing listing. Each new release needs a unique version. [Manage publishers](https://marketplace.visualstudio.com/manage)
