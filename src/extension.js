const vscode = require("vscode");
const path = require("path");
const fs = require("fs").promises;
const { createReadStream } = require("fs");
const readline = require("readline");

const TAGS = ["BUG", "HACK", "FIXME", "TODO", "XXX"];
const TAG_PATTERN = `\\b(${TAGS.join("|")})\\b:?\\s*(.*)`;
const CACHE_VERSION = 7;
const MAX_FILES = 20000;
const BATCH_SIZE = 200;
const DEBOUNCE_TIME = 100;

class UltimateTodoProvider {
  constructor(context) {
    this.context = context;
    this.cache = new Map();
    this.fileMap = new Map();
    this.activeOperations = new Set();
    this.processingQueue = [];
    this.debounceTimer = null;
    this.isInitialScanComplete = false;

    this.decorationType = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
      backgroundColor: "white",
      border: "1px solid white",
    });

    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
  }

  async initialize() {
    await this.loadCache();
    this.showCachedData();
    this.setupWatchers();
    await this.backgroundFullScan();
  }

  async backgroundFullScan() {
    try {
      const uris = await vscode.workspace.findFiles(
        "**/*",
        "**/{node_modules,vendor,dist,out,build,.git}/**",
        MAX_FILES
      );

      await this.processFileBatch(uris.map(uri => uri.fsPath));
      this.isInitialScanComplete = true;
      this.updateView();
    } catch (error) {
      vscode.window.showErrorMessage(`Background scan failed: ${error.message}`);
    }
  }

  showCachedData() {
    this._onDidChange.fire();
    this.applyHighlightsToAllEditors();
  }

  setupWatchers() {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    this.context.subscriptions.push(
      watcher,
      watcher.onDidChange(uri => this.queueProcessing(uri, true)),
      watcher.onDidCreate(uri => this.handleNewFile(uri)),
      watcher.onDidDelete(uri => this.handleFileDelete(uri))
    );
  }

  handleNewFile(uri) {
    this.queueProcessing(uri, true);
  }

  queueProcessing(uri, isPriority = false) {
    const filePath = uri.fsPath;
    if (!this.processingQueue.includes(filePath)) {
      isPriority ? this.processingQueue.unshift(filePath) : this.processingQueue.push(filePath);
    }
    this.debounceProcess();
  }

  debounceProcess() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.processQueue(), DEBOUNCE_TIME);
  }

  async processQueue() {
    const batch = this.processingQueue.splice(0, BATCH_SIZE);
    await this.processFileBatch(batch);
    if (this.processingQueue.length > 0) {
      this.debounceProcess();
    }
  }

  async processFileBatch(filePaths) {
    await Promise.allSettled(
      filePaths.map(filePath =>
        this.processSingleFile(filePath)
          .catch(error => this.handleFileError(filePath, error))
      )
    );
    this.updateView();
    this.applyHighlightsToAllEditors();
  }

  async processSingleFile(filePath) {
    if (this.activeOperations.has(filePath)) return;
    this.activeOperations.add(filePath);

    try {
      const stats = await fs.stat(filePath);
      const cacheEntry = this.cache.get(filePath);

      if (!this.shouldReprocess(cacheEntry, stats)) return;

      const items = await this.parseFileStream(filePath);
      this.updateMaps(filePath, items, stats.mtimeMs);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.handleFileDelete(vscode.Uri.file(filePath));
      }
    } finally {
      this.activeOperations.delete(filePath);
    }
  }

  shouldReprocess(cacheEntry, stats) {
    return !cacheEntry ||
      cacheEntry.mtime !== stats.mtimeMs ||
      !this.isInitialScanComplete;
  }

  async parseFileStream(filePath) {
    return new Promise((resolve, reject) => {
      const items = [];
      const stream = createReadStream(filePath, { encoding: "utf8" });
      const rl = readline.createInterface({ input: stream });
      let lineNumber = 0;

      rl.on("line", line => {
        const matches = [...line.matchAll(new RegExp(TAG_PATTERN, "g"))];
        matches.forEach(match => {
          const [_, tag, comment] = match;
          if (TAGS.includes(tag)) {
            items.push({
              tag: tag,
              text: comment.trim(),
              line: lineNumber,
              position: match.index,
              file: filePath
            });
          }
        });
        lineNumber++;
      });

      rl.on("close", () => resolve(items));
      rl.on("error", reject);
    });
  }

  updateMaps(filePath, items, mtime) {
    const currentItems = this.fileMap.get(filePath) || [];
    const mergedItems = this.mergeItems(currentItems, items);

    if (mergedItems.length > 0) {
      this.fileMap.set(filePath, mergedItems);
      this.cache.set(filePath, { mtime, items: mergedItems });
    } else {
      this.fileMap.delete(filePath);
      this.cache.delete(filePath);
    }
  }

  mergeItems(oldItems, newItems) {
    const itemMap = new Map();

    newItems.forEach(item => {
      const key = `${item.line}:${item.position}`;
      itemMap.set(key, item);
    });

    oldItems.forEach(item => {
      const key = `${item.line}:${item.position}`;
      if (!itemMap.has(key)) {
        itemMap.set(key, item);
      }
    });

    return Array.from(itemMap.values());
  }

  async loadCache() {
    try {
      const cacheData = await this.context.globalState.get(`todoCache_v${CACHE_VERSION}`, {});
      Object.entries(cacheData).forEach(([path, entry]) => {
        if (entry?.items) {
          this.cache.set(path, entry);
          this.fileMap.set(path, entry.items);
        }
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Cache load failed: ${error.message}`);
    }
  }

  async saveCache() {
    try {
      const cacheData = Object.fromEntries(this.cache);
      await this.context.globalState.update(`todoCache_v${CACHE_VERSION}`, cacheData);
    } catch (error) {
      vscode.window.showErrorMessage(`Cache save failed: ${error.message}`);
    }
  }

  updateView() {
    this._onDidChange.fire();
    this.saveCache();
  }

  applyHighlightsToAllEditors() {
    vscode.window.visibleTextEditors.forEach(editor => {
      this.applyHighlights(editor);
    });
  }

  applyHighlights(editor = vscode.window.activeTextEditor) {
    try {
      if (!editor) return;

      const uri = editor.document.uri.fsPath;
      const items = this.fileMap.get(uri) || [];

      const validItems = items.filter(item =>
        TAGS.includes(item.tag) && item.tag === item.tag.toUpperCase()
      );

      const ranges = validItems.map(item =>
        new vscode.Range(
          new vscode.Position(item.line, item.position),
          new vscode.Position(item.line, item.position + item.tag.length)
        )
      );

      editor.setDecorations(this.decorationType, ranges);
    } catch (error) {
      vscode.window.showErrorMessage(`Highlighting failed: ${error.message}`);
    }
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    return element ? (element.children || []) : this.buildTreeStructure();
  }

  buildTreeStructure() {
    const tree = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    this.fileMap.forEach((items, filePath) => {
      if (!workspaceRoot || !filePath.startsWith(workspaceRoot)) return;

      const relativePath = path.relative(workspaceRoot, filePath);
      const parts = relativePath.split(path.sep);
      let currentLevel = tree;

      parts.forEach((part, index) => {
        let node = currentLevel.find(n => n.label === part);
        if (!node) {
          node = {
            label: part,
            children: [],
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            path: path.join(workspaceRoot, ...parts.slice(0, index + 1))
          };
          currentLevel.push(node);
        }
        currentLevel = node.children;
      });

      items.forEach(item => {
        currentLevel.push({
          label: `[${item.tag}] ${item.text}`,
          description: `Line ${item.line + 1}`,
          tooltip: `${relativePath}:${item.line + 1}`,
          command: {
            command: "vscode.open",
            title: "Open File",
            arguments: [
              vscode.Uri.file(filePath),
              { selection: new vscode.Range(item.line, 0, item.line, 0) }
            ]
          }
        });
      });
    });

    return tree.sort((a, b) => a.label.localeCompare(b.label));
  }
}

function activate(context) {
  const provider = new UltimateTodoProvider(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("todoTreeView", provider),
    vscode.commands.registerCommand("codeTODO.refresh", () => provider.initialize()),
    vscode.workspace.onDidSaveTextDocument(doc =>
      provider.queueProcessing(doc.uri, true)),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) provider.applyHighlights(editor);
    }),
    {
      dispose: () => {
        provider.saveCache();
      }
    }
  );

  provider.initialize();
  return provider;
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
};