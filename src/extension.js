const vscode = require('vscode');
const path = require('path');
const fs = require('fs').promises;
const { createReadStream } = require('fs');
const readline = require('readline');

const TAGS = ['BUG', 'HACK', 'FIXME', 'TODO', 'XXX'];
const TAG_PATTERN = `\\b(${TAGS.join('|')})(?=\\s|:)[:]?\\s*(.*)`;
const CACHE_VERSION = 12;
const MAX_CONCURRENT_FILES = 75;
const DEBOUNCE_TIME = 100;

class UltimateTodoProvider {
  constructor(context) {
    this.context = context;
    this.cache = new Map();
    this.fileMap = new Map();
    this.activeOperations = new Set();
    this.processingQueue = new Set();
    this.debounceTimer = null;
    this.isInitialized = false;

    this.decorationType = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
      backgroundColor: 'rgba(255, 255, 255, 0.68)',
      color: 'rgba(0, 0, 0, 0.68)',
      border: '1px solid rgba(255, 255, 255, 0.68)',
      borderRadius: '3px',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;

    this.initialize();
  }

  async initialize() {
    await this.loadCache();
    this.setupWatchers();
    this.applyHighlightsToAllEditors();
    this.startBackgroundProcessing();
  }

  async startBackgroundProcessing() {
    try {
      const uris = await vscode.workspace.findFiles(
        '**/*.{js,ts,jsx,tsx,php,py,java,cs,cpp,h,html,css,md,json}',
        '**/{node_modules,vendor,dist,out,build,.git}/**'
      );

      this.updateFileList(uris);
      this.isInitialized = true;
    } catch (error) {
      vscode.window.showErrorMessage(`Initialization failed: ${error.message}`);
    }
  }

  async updateFileList(uris) {
    const currentFiles = new Set(uris.map(uri => uri.fsPath));

    // Process new files first
    uris.forEach(uri => {
      if (!this.cache.has(uri.fsPath)) {
        this.queueProcessing(uri.fsPath, true);
      }
    });

    // Remove deleted files
    Array.from(this.cache.keys()).forEach(filePath => {
      if (!currentFiles.has(filePath)) {
        this.handleFileDelete(vscode.Uri.file(filePath));
      }
    });
  }

  setupWatchers() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');

    this.context.subscriptions.push(
      watcher,
      watcher.onDidChange(uri => this.queueProcessing(uri.fsPath, true)),
      watcher.onDidCreate(uri => this.queueProcessing(uri.fsPath, true)),
      watcher.onDidDelete(uri => this.handleFileDelete(uri)),
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) this.applyHighlights(editor);
      })
    );
  }

  handleFileDelete(uri) {
    const filePath = uri.fsPath;
    this.fileMap.delete(filePath);
    this.cache.delete(filePath);
    this.updateView();
    this.applyHighlightsToAllEditors();
  }

  queueProcessing(filePath, isPriority = false) {
    if (!this.processingQueue.has(filePath)) {
      this.processingQueue.add(filePath);
      this.debounceProcess();
    }
  }

  debounceProcess() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.processQueue(), DEBOUNCE_TIME);
  }

  async processQueue() {
    if (!this.isInitialized) return;

    const batch = [];
    const iterator = this.processingQueue.values();

    while (batch.length < MAX_CONCURRENT_FILES) {
      const { value, done } = iterator.next();
      if (done) break;
      batch.push(value);
    }

    if (batch.length > 0) {
      await this.processFileBatch(batch);
      batch.forEach(file => this.processingQueue.delete(file));
      this.debounceProcess();
    }
  }

  async processFileBatch(filePaths) {
    await Promise.all(
      filePaths.map(filePath =>
        this.processSingleFile(filePath).catch(error => console.error(error))
      ));
    this.updateView();
  }

  async processSingleFile(filePath) {
    if (this.activeOperations.has(filePath)) return;
    this.activeOperations.add(filePath);

    try {
      const stats = await fs.stat(filePath);
      const cacheEntry = this.cache.get(filePath);

      if (cacheEntry?.mtime === stats.mtimeMs) return;

      const items = await this.parseFileStream(filePath);
      this.updateFileData(filePath, items, stats.mtimeMs);
      this.applyHighlightsForFile(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.handleFileDelete(vscode.Uri.file(filePath));
      }
    } finally {
      this.activeOperations.delete(filePath);
    }
  }

  applyHighlightsForFile(filePath) {
    vscode.window.visibleTextEditors.forEach(editor => {
      if (editor.document.uri.fsPath === filePath) {
        this.applyHighlights(editor);
      }
    });
  }

  updateFileData(filePath, newItems, mtime) {
    const currentItems = this.fileMap.get(filePath) || [];
    const itemsMap = new Map();

    newItems.forEach(item => {
      const key = `${item.line}:${item.position}`;
      itemsMap.set(key, item);
    });

    const mergedItems = Array.from(itemsMap.values());

    if (mergedItems.length > 0) {
      this.fileMap.set(filePath, mergedItems);
      this.cache.set(filePath, { mtime, items: mergedItems });
    } else {
      this.fileMap.delete(filePath);
      this.cache.delete(filePath);
    }
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
      console.error('Cache save error:', error);
    }
  }

  updateView(force = false) {
    this._onDidChange.fire();
    if (force) {
      this.saveCache();
    }
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
    try {
      if (element) {
        return element.children || [];
      }
      return this.buildTreeStructure();
    } catch (error) {
      return [];
    }
  }

  buildTreeStructure() {
    const tree = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) return tree;

    this.fileMap.forEach((items, filePath) => {
      if (!filePath.startsWith(workspaceRoot)) return;

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
    vscode.commands.registerCommand("codeTODO.refresh", () => provider.backgroundFullScan()),
    vscode.workspace.onDidSaveTextDocument(doc =>
      provider.queueProcessing(doc.uri, true)),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      provider.applyHighlights(editor);
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