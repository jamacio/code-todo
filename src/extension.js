// © 2025 Jamácio Rocha - Licensed under Non-Commercial OSS
const vscode = require('vscode');
const path = require('path');
const fs = require('fs').promises;
const { createReadStream } = require('fs');
const readline = require('readline');

const TAGS = ['BUG', 'HACK', 'FIXME', 'TODO', 'XXX'];
const TAG_PATTERN = `\\b(${TAGS.join('|')})(?=\\s|:)[:]?\\s*(.*)`;
const CACHE_VERSION = 36;
const MAX_CONCURRENT_FILES = 100;
const DEBOUNCE_TIME = 25;
const BATCH_DISPLAY_SIZE = 5;

class UltimateTodoProvider {
  constructor(context) {
    this.context = context;
    this.cache = new Map();
    this.fileMap = new Map();
    this.activeOperations = new Set();
    this.processingQueue = new Set();
    this.debounceTimer = null;
    this.isInitialized = false;
    this.initialScanComplete = false;
    this.accumulatedTodos = 0;

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

    this.initialize().catch(error =>
      vscode.window.showErrorMessage(`Initialization error: ${error.message}`)
    );
  }

  async initialize() {
    await this.loadCache();
    this.setupWatchers();
    await this.startBackgroundProcessing();
  }

  refresh() {
    this._onDidChange.fire();
  }

  async startBackgroundProcessing() {
    try {
      const uris = await vscode.workspace.findFiles(
        '**/*.{js,ts,jsx,tsx,php,py,java,cs,cpp,h,html,css,md,json}',
        '**/{node_modules,vendor,dist,out,build,.git}/**'
      );

      this.updateFileList(uris);
      this.isInitialized = true;

      if (!this.initialScanComplete) {
        await this.processFullDiscovery();
        this.initialScanComplete = true;
        await this.saveCache();
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Background processing failed: ${error.message}`);
    }
  }

  async processFullDiscovery() {
    const files = Array.from(this.processingQueue);
    this.processingQueue.clear();

    while (files.length > 0) {
      const batch = files.splice(0, MAX_CONCURRENT_FILES);
      const results = await Promise.all(batch.map(filePath =>
        this.processSingleFile(filePath).catch(() => 0)
      ));

      const newTodos = results.reduce((sum, count) => sum + count, 0);
      this.accumulatedTodos += newTodos;

      while (this.accumulatedTodos >= BATCH_DISPLAY_SIZE) {
        this.refresh();
        this.accumulatedTodos -= BATCH_DISPLAY_SIZE;
      }
    }

    if (this.accumulatedTodos > 0) {
      this.refresh();
    }
  }

  updateFileList(uris) {
    const currentFiles = new Set(uris.map(uri => uri.fsPath));

    Array.from(this.cache.keys()).forEach(filePath => {
      if (!currentFiles.has(filePath)) {
        this.handleFileDelete(vscode.Uri.file(filePath));
      }
    });

    uris.forEach(uri => {
      if (!this.cache.has(uri.fsPath)) {
        this.processingQueue.add(uri.fsPath);
      }
    });
  }

  setupWatchers() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');

    this.context.subscriptions.push(
      watcher,
      watcher.onDidChange(uri => this.queueFileUpdate(uri.fsPath)),
      watcher.onDidCreate(uri => this.queueFileUpdate(uri.fsPath)),
      watcher.onDidDelete(uri => this.handleFileDelete(uri)),
      vscode.window.onDidChangeActiveTextEditor(editor =>
        this.applyHighlights(editor)
      )
    );
  }

  handleFileDelete(uri) {
    const filePath = uri.fsPath;
    this.fileMap.delete(filePath);
    this.cache.delete(filePath);
    this.updateView(true);
  }

  queueFileUpdate(filePath) {
    if (!this.initialScanComplete || this.processingQueue.has(filePath)) return;
    this.processingQueue.add(filePath);
    this.debounceProcess();
  }

  debounceProcess() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.processIncrementalUpdates(), DEBOUNCE_TIME);
  }

  async processIncrementalUpdates() {
    while (this.processingQueue.size > 0) {
      const batch = Array.from(this.processingQueue)
        .slice(0, MAX_CONCURRENT_FILES);

      this.processingQueue = new Set(
        Array.from(this.processingQueue)
          .slice(MAX_CONCURRENT_FILES)
      );

      await Promise.all(batch.map(filePath =>
        this.processSingleFile(filePath)
          .catch(error => console.error(`Error processing ${filePath}:`, error))
      ));

      this.updateView(true);
    }
  }

  async processSingleFile(filePath) {
    if (this.activeOperations.has(filePath)) return 0;
    this.activeOperations.add(filePath);

    try {
      const stats = await fs.stat(filePath);
      const cacheEntry = this.cache.get(filePath);

      if (cacheEntry?.mtime === stats.mtimeMs) return 0;

      const items = await this.parseFileStream(filePath);
      const count = items.length;
      this.updateFileData(filePath, items, stats.mtimeMs);
      this.applyHighlightsForFile(filePath);
      return count;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.handleFileDelete(vscode.Uri.file(filePath));
        return 0;
      }
      console.error(`Error processing ${filePath}:`, error);
      return 0;
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
    const itemsMap = new Map(newItems.map(item =>
      [`${item.line}:${item.position}`, item]
    ));
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
      const rl = readline.createInterface({
        input: createReadStream(filePath, 'utf8'),
        crlfDelay: Infinity
      });

      let lineNumber = 0;

      rl.on('line', (line) => {
        const matches = [...line.matchAll(new RegExp(TAG_PATTERN, 'g'))];

        for (const match of matches) {
          const [_, tag, comment] = match;
          if (TAGS.includes(tag.toUpperCase())) {
            items.push({
              tag: tag.toUpperCase(),
              text: comment.trim(),
              line: lineNumber,
              position: match.index,
              file: filePath
            });
          }
        }
        lineNumber++;
      });

      rl.on('close', () => resolve(items));
      rl.on('error', reject);
    });
  }

  async loadCache() {
    try {
      const cacheData = await this.context.globalState.get(
        `todoCache_v${CACHE_VERSION}`,
        {}
      );

      Object.entries(cacheData).forEach(([path, entry]) => {
        if (entry?.items) {
          this.cache.set(path, entry);
          this.fileMap.set(path, entry.items);
        }
      });
      this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Cache load failed: ${error.message}`);
    }
  }

  async saveCache() {
    try {
      await this.context.globalState.update(
        `todoCache_v${CACHE_VERSION}`,
        Object.fromEntries(this.cache)
      );
    } catch (error) {
      console.error('Cache save error:', error);
    }
  }

  updateView(force = false) {
    this.refresh();
    if (force && this.initialScanComplete) {
      this.saveCache();
    }
  }

  applyHighlights(editor) {
    try {
      if (!editor) return;
      const uri = editor.document.uri.fsPath;
      const items = this.fileMap.get(uri) || [];

      const ranges = items
        .filter(item => TAGS.includes(item.tag))
        .map(item => new vscode.Range(
          new vscode.Position(item.line, item.position),
          new vscode.Position(item.line, item.position + item.tag.length)
        ));

      editor.setDecorations(this.decorationType, ranges);
    } catch (error) {
      console.error('Highlight error:', error);
    }
  }

  getTreeItem(element) { return element; }

  async getChildren(element) {
    return element ? element.children : this.buildTreeStructure();
  }

  buildTreeStructure() {
    const tree = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return tree;

    this.fileMap.forEach((items, filePath) => {
      if (!filePath.startsWith(workspaceRoot)) return;
      const relativePath = path.relative(workspaceRoot, filePath);
      let currentLevel = tree;

      relativePath.split(path.sep).forEach((part, index) => {
        let node = currentLevel.find(n => n.label === part);
        if (!node) {
          node = {
            label: part,
            children: [],
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            path: path.join(
              workspaceRoot,
              ...relativePath.split(path.sep).slice(0, index + 1)
            )
          };
          currentLevel.push(node);
        }
        currentLevel = node.children;
      });

      items.forEach(item => currentLevel.push({
        label: `[${item.tag}] ${item.text}`,
        description: `Line ${item.line + 1}`,
        command: {
          command: "vscode.open",
          title: "Open File",
          arguments: [
            vscode.Uri.file(filePath),
            { selection: new vscode.Range(item.line, 0, item.line, 0) }
          ]
        }
      }));
    });

    return tree.sort((a, b) => a.label.localeCompare(b.label));
  }
}

function activate(context) {
  const provider = new UltimateTodoProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("todoTreeView", provider),
    vscode.commands.registerCommand("codeTODO.refresh", () => {
      provider.cache.clear();
      provider.fileMap.clear();
      provider.processingQueue.clear();
      provider.initialScanComplete = false;
      provider.startBackgroundProcessing();
    }),
    { dispose: () => provider.saveCache() }
  );
  return provider;
}

function deactivate() { }

module.exports = { activate, deactivate };