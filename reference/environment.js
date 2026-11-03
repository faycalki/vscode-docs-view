'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Catalog } = require('./catalog');
function runIndex(executable, script, destination, progress, token) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-I', '-u', script, '--out', destination], {
      cwd: destination,
      shell: false,
      windowsHide: true,
      env: { ...process.env, MPLBACKEND: 'Agg', MPLCONFIGDIR: path.join(destination, 'mpl-cache') }
    });
    const cancel = token.onCancellationRequested(() => child.kill());
    if (token.isCancellationRequested) child.kill();
    let tail = '';
    child.stdout.on('data', (chunk) => {
      const line = chunk.toString().trim().split(/\r?\n/).pop();
      if (line) progress.report({ message: line.slice(0, 130) });
    });
    child.stderr.on('data', (chunk) => {
      tail = (tail + chunk).slice(-2200);
    });
    child.once('error', (err) => {
      cancel.dispose();
      reject(err);
    });
    child.once('close', (code) => {
      cancel.dispose();
      if (token.isCancellationRequested) return reject(new Error('Indexing canceled.'));
      if (code !== 0)
        return reject(
          new Error(
            tail.trim().split('\n').slice(-2).join(' ') || 'The indexer exited with code ' + code
          )
        );
      resolve();
    });
  });
}

async function suggestedPython(ctx, resource) {
  const ext = vscode.extensions.getExtension('ms-python.python');
  if (ext) {
    try {
      const api = await ext.activate();
      const active = api.environments.getActiveEnvironmentPath(resource);
      const env = await api.environments.resolveEnvironment(active);
      if (env && env.executable && env.executable.uri) return env.executable.uri.fsPath;
    } catch {
      // The interpreter field stays editable when the Python extension has no selection.
    }
  }
  return ctx.workspaceState.get('pythonExecutable', process.platform === 'win32' ? 'python' : 'python3');
}

function createEnvironment(ctx, changed) {
  const bundled = path.join(ctx.extensionPath, 'reference', 'data');
  const storage = path.join((ctx.storageUri || ctx.globalStorageUri).fsPath, 'reference-packs');
  let loading,
    busy = false;
  function catalog() {
    if (!loading) {
      const snap = ctx.workspaceState.get('snapshot');
      const dir =
        typeof snap === 'string' && /^env-[a-zA-Z0-9]+$/.test(snap) ? path.join(storage, snap) : null;
      loading = Catalog.load(bundled, dir).catch(async (err) => {
        if (!dir) {
          loading = undefined;
          throw err;
        }
        vscode.window.showWarningMessage(
          'Docs View could not read the saved environment index. Showing bundled docs. ' + err.message
        );
        return Catalog.load(bundled);
      });
    }
    return loading;
  }
  async function rebuild() {
    if (busy)
      return vscode.window.showInformationMessage('Docs View is already indexing an environment.');
    if (!vscode.workspace.isTrusted)
      return vscode.window.showWarningMessage(
        'Index Python Environment is available in trusted workspaces. The bundled reference is ready to search.'
      );
    busy = true;
    let target;
    try {
      const resource =
        vscode.window.activeTextEditor?.document.uri || vscode.workspace.workspaceFolders?.[0]?.uri;
      const executable = await vscode.window.showInputBox({
        title: 'Index Python environment',
        prompt:
          'Python 3.10+ executable to import installed reference packages from. You can paste the path printed by sys.executable.',
        value: await suggestedPython(ctx, resource),
        ignoreFocusOut: true
      });
      if (!executable || !executable.trim()) return;
      await fs.mkdir(storage, { recursive: true });
      target = await fs.mkdtemp(path.join(storage, 'env-'));
      const destination = target;
      const next = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Docs View · building local reference',
          cancellable: true
        },
        async (progress, token) => {
          await runIndex(
            executable.trim(),
            path.join(ctx.extensionPath, 'reference', 'scripts', 'build_index.py'),
            destination,
            progress,
            token
          );
          const next = await Catalog.load(bundled, destination);
          if (token.isCancellationRequested) throw new Error('Indexing canceled.');
          return next;
        }
      );
      await ctx.workspaceState.update('snapshot', path.basename(destination));
      target = undefined; // The validated snapshot now owns this directory.
      loading = Promise.resolve(next);
      await ctx.workspaceState.update('pythonExecutable', executable.trim());
      changed();
      const local = next.packs
        .filter((p) => p.local)
        .map((p) => p.label + ' ' + p.version)
        .join(', ');
      const kept = next.packs
        .filter((p) => !p.local)
        .map((p) => p.label)
        .join(', ');
      vscode.window.showInformationMessage(
        'Indexed ' + local + '.' + (kept ? ' Using bundled docs for ' + kept + '.' : '')
      );
    } finally {
      if (target) await fs.rm(target, { recursive: true, force: true }).catch(() => {});
      busy = false;
    }
  }
  async function reset() {
    if (busy)
      return vscode.window.showInformationMessage(
        'Finish or cancel indexing before switching references.'
      );
    const next = await Catalog.load(bundled);
    await ctx.workspaceState.update('snapshot', undefined);
    loading = Promise.resolve(next);
    changed();
    vscode.window.showInformationMessage('Docs View is using the bundled reference.');
  }
  return { catalog, rebuild, reset };
}

module.exports = { createEnvironment };
