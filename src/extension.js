const vscode = require('vscode');
const path = require('path');
const fs = require('fs').promises;
const { createReadStream, existsSync } = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

const CACHE_VERSION = 45;
const SUPPORTED_EXT = '{js,ts,jsx,tsx,vue,php,py,java,cs,cpp,h,hpp,html,css,scss,less,sass,md,txt,yaml,yml,json,xml,rb,go,rs,kt,swift,m,mm,dart,lua,pl,pm,sh,bash,zsh,ps1,psm1}';
const WATCHER_GLOB = `**/*.${SUPPORTED_EXT}`;
const EXCLUDE_DIRS = ['node_modules', 'vendor', 'dist', 'out', 'build', '.git', '.vscode', 'coverage', 'tmp', 'temp', '__pycache__', 'venv', '.venv', 'env', '.env', 'bundle', '.next', '.nuxt', '.cache', 'public/build'];
const EXCLUDE_GLOB = `**/{${EXCLUDE_DIRS.join(',')}}/**`;
const EXCLUDE_FILES = ['*.min.js', '*.min.css', '*.map', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

const DEFAULT_TAGS = ['BUG', 'HACK', 'FIXME', 'TODO', 'XXX', 'NOTE', 'OPTIMIZE', 'REVIEW'];
const TAG_ICONS = {
  'TODO': 'checklist',
  'FIXME': 'tools',
  'BUG': 'bug',
  'HACK': 'warning',
  'XXX': 'alert',
  'NOTE': 'info',
  'OPTIMIZE': 'zap',
  'REVIEW': 'eye',
};

let todoConfig = {
  tags: DEFAULT_TAGS,
  tagSet: new Set(DEFAULT_TAGS),
  maxFileSize: 2 * 1024 * 1024,
};

class TodoItem {
  constructor(tag, text, line, column, file) {
    this.tag = tag;
    this.text = text;
    this.line = line;
    this.column = column;
    this.file = file;
  }

  get range() {
    return new vscode.Range(
      new vscode.Position(this.line, this.column),
      new vscode.Position(this.line, this.column + this.tag.length)
    );
  }
}

class TodoTreeProvider {
  constructor(context) {
    this.context = context;
    this.cache = new Map();
    this.fileMap = new Map();
    this._cacheReady = false;
    this.isScanning = false;
    this.docTimers = new Map();
    this.updateTimers = new Map();
    this.cachedTree = [];
    this.treeNeedsRebuild = true;
    this._tagStructures = new Map();
    this.refreshTimer = null;
    this.saveCacheTimer = null;
    this.totalsByTag = {};
    this.totalTodos = 0;
    this._rgPath = undefined;
    this._rgProcess = null;
    context.subscriptions.push({
      dispose: () => { if (this._rgProcess) this._rgProcess.kill(); }
    });

    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.regex = this._buildRegex();

    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 255, 255, 0.68)',
      color: 'rgba(0, 0, 0, 0.68)',
      border: '1px solid rgba(255, 255, 255, 0.68)',
      borderRadius: '3px',
      overviewRulerColor: 'yellow',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.statusBarItem.command = 'codeTODO.refresh';
    this.statusBarItem.tooltip = 'Code TODO - Click to refresh';
    context.subscriptions.push(this.statusBarItem);

    this._initialize();
  }

  _buildRegex() {
    return new RegExp(`\\b(${todoConfig.tags.join('|')})(?=\\s|:)[:]?\\s*(.*)`, 'g');
  }

  async _initialize() {
    this._loadConfig();
    await this._loadCacheAsync();
    this._cacheReady = true;
    this._applyHighlightsToActiveEditor();
    if (this.fileMap.size > 0) {
      this.treeNeedsRebuild = true;
      this._debouncedRefresh();
    }
    this._setupWatchers();
    this.startScan();
  }

  _loadConfig() {
    try {
      const config = vscode.workspace.getConfiguration('codeTODO');
      if (config) {
        const customTags = config.get('tags');
        if (customTags && Array.isArray(customTags) && customTags.length > 0) {
          todoConfig.tags = customTags;
          todoConfig.tagSet = new Set(customTags.map(t => t.toUpperCase()));
          this.regex = this._buildRegex();
        }
      }
    } catch (e) { }
  }

  async _loadCacheAsync() {
    try {
      const cacheData = this.context.globalState.get(`todoCache_v${CACHE_VERSION}`);
      if (!cacheData) return;

      // No per-file fs.access here: the full scan that follows reconciles
      // deleted files, so the cached tree can be shown immediately.
      for (const filePath in cacheData) {
        const entry = cacheData[filePath];
        if (entry?.items && Array.isArray(entry.items) && entry.items.length > 0) {
          this.cache.set(filePath, entry);
          this.fileMap.set(filePath, entry.items);
        }
      }

      this._updateStats();
    } catch (error) {
      console.error('Cache load failed:', error);
    }
  }

  async startScan() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const rgPath = this._getRipgrepPath();
      if (rgPath && await this._scanWithRipgrep(rgPath)) return;

      const uris = await vscode.workspace.findFiles(
        `**/*.${SUPPORTED_EXT}`,
        EXCLUDE_GLOB
      );

      const filesToProcess = [];
      const found = new Set();

      for (let i = 0; i < uris.length; i++) {
        const filePath = uris[i].fsPath;
        found.add(filePath);
        try {
          const stats = await fs.stat(filePath);
          const cacheEntry = this.cache.get(filePath);
          if (!cacheEntry ||
            cacheEntry.mtime !== stats.mtimeMs ||
            cacheEntry.size !== stats.size) {
            filesToProcess.push(filePath);
          }
        } catch {
          this._handleFileDelete(filePath);
        }
      }

      for (const filePath of [...this.fileMap.keys()]) {
        if (!found.has(filePath)) this._handleFileDelete(filePath);
      }

      if (filesToProcess.length > 0) {
        await this._processFilesInBatches(filesToProcess);
        await this._saveCache();
      }

      this._updateStats();
      this._applyHighlightsToActiveEditor();

      if (filesToProcess.length > 0 || this.treeNeedsRebuild) {
        this.treeNeedsRebuild = true;
        this._debouncedRefresh();
      }
    } catch (error) {
      console.error('Scan failed:', error);
    } finally {
      this.isScanning = false;
    }
  }

  _getRipgrepPath() {
    if (this._rgPath !== undefined) return this._rgPath;

    // VS Code ships ripgrep; its location has moved across releases.
    const exe = process.platform === 'win32' ? 'rg.exe' : 'rg';
    const platformDir = `${process.platform}-${process.arch}`;
    const appRoot = vscode.env.appRoot;
    const candidates = [
      path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep-universal', 'bin', platformDir, exe),
      path.join(appRoot, 'node_modules', '@vscode', 'ripgrep-universal', 'bin', platformDir, exe),
      path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', exe),
      path.join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', exe),
      path.join(appRoot, 'node_modules.asar.unpacked', 'vscode-ripgrep', 'bin', exe),
      path.join(appRoot, 'node_modules', 'vscode-ripgrep', 'bin', exe),
    ];

    this._rgPath = null;
    for (let i = 0; i < candidates.length; i++) {
      if (existsSync(candidates[i])) {
        this._rgPath = candidates[i];
        break;
      }
    }
    return this._rgPath;
  }

  // Native multi-threaded search: ripgrep only returns candidate lines, so
  // no file is opened or stat'ed from JS. Returns false if rg can't run.
  async _scanWithRipgrep(rgPath) {
    const folders = vscode.workspace.workspaceFolders || [];
    const results = new Map();

    for (let i = 0; i < folders.length; i++) {
      if (folders[i].uri.scheme !== 'file') continue;
      const ok = await this._runRipgrep(rgPath, folders[i].uri.fsPath, results);
      if (!ok) {
        this._rgPath = null;
        return false;
      }
    }

    // Unsaved editors take precedence over what is on disk.
    const docs = vscode.workspace.textDocuments;
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      if (!doc.isDirty || doc.uri.scheme !== 'file' || !this._shouldProcessFile(doc.uri.fsPath)) continue;
      const items = this._parseContent(doc.getText(), doc.uri.fsPath);
      if (items.length > 0) results.set(doc.uri.fsPath, items);
      else results.delete(doc.uri.fsPath);
    }

    this.fileMap = results;
    this.cache = new Map();
    for (const [filePath, items] of results) {
      this.cache.set(filePath, { items });
    }

    this._updateStats();
    this._applyHighlightsToActiveEditor();
    this.treeNeedsRebuild = true;
    this._debouncedRefresh();
    await this._saveCache();
    return true;
  }

  _runRipgrep(rgPath, folder, results) {
    const args = [
      '--no-messages', '--no-config', '--color', 'never',
      '--no-heading', '--with-filename', '--line-number', '--null', '--hidden',
      '--max-columns', '1000',
      '--max-filesize', `${Math.floor(todoConfig.maxFileSize / 1024)}K`,
      '-g', `*.${SUPPORTED_EXT}`,
    ];
    for (let i = 0; i < EXCLUDE_DIRS.length; i++) args.push('-g', `!**/${EXCLUDE_DIRS[i]}/**`);
    for (let i = 0; i < EXCLUDE_FILES.length; i++) args.push('-g', `!${EXCLUDE_FILES[i]}`);
    // Coarse filter only; the JS regex below extracts tag, text and column.
    const tagPattern = todoConfig.tags.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    args.push('-e', `\\b(${tagPattern})\\b`, folder);

    return new Promise(resolve => {
      let child;
      try {
        child = spawn(rgPath, args, { cwd: folder });
      } catch {
        resolve(false);
        return;
      }
      this._rgProcess = child;

      // Output per line: <path>\0<line>:<text>
      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const sep = line.indexOf('\0');
        if (sep < 0) return;
        const colon = line.indexOf(':', sep + 1);
        if (colon < 0) return;
        const filePath = line.slice(0, sep);
        const lineNumber = parseInt(line.slice(sep + 1, colon), 10) - 1;
        const text = line.slice(colon + 1);

        this.regex.lastIndex = 0;
        let match;
        while ((match = this.regex.exec(text)) !== null) {
          const tag = match[1].toUpperCase();
          if (todoConfig.tagSet.has(tag)) {
            let items = results.get(filePath);
            if (!items) {
              items = [];
              results.set(filePath, items);
            }
            items.push(new TodoItem(tag, match[2].trim(), lineNumber, match.index, filePath));
          }
        }
      });

      let spawnFailed = false;
      child.on('error', () => {
        spawnFailed = true;
        this._rgProcess = null;
        rl.close();
        resolve(false);
      });
      // Exit code 1 means "no matches"; 2 can still carry valid partial
      // results (e.g. unreadable subfolders), so only a spawn error fails.
      child.on('close', () => {
        this._rgProcess = null;
        rl.close();
        resolve(!spawnFailed);
      });
    });
  }

  async _processFilesInBatches(files) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(filePath => this._processFile(filePath))
      );
      if (i + BATCH_SIZE < files.length) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }

  async _processFile(filePath) {
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > todoConfig.maxFileSize) return false;

      const items = await this._parseFile(filePath);
      const changed = this._updateFileMap(filePath, items);

      if (changed) {
        this.cache.set(filePath, {
          mtime: stats.mtimeMs,
          size: stats.size,
          items: items
        });
      }

      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.fsPath === filePath) {
        this._applyHighlights(editor);
      }

      return changed;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this._handleFileDelete(filePath);
      }
      return false;
    }
  }

  _updateFileMap(filePath, items) {
    const oldItems = this.fileMap.get(filePath);
    const changed = this._itemsChanged(oldItems, items);

    if (items.length > 0) {
      this.fileMap.set(filePath, items);
    } else {
      this.fileMap.delete(filePath);
    }

    if (changed) {
      this.treeNeedsRebuild = true;
      this._updateStatsIncremental(oldItems || [], items);
    }

    return changed;
  }

  _itemsChanged(oldItems, newItems) {
    if (!oldItems && (!newItems || newItems.length === 0)) return false;
    if (!oldItems || !newItems) return true;
    if (oldItems.length !== newItems.length) return true;
    for (let i = 0; i < oldItems.length; i++) {
      if (oldItems[i].line !== newItems[i].line ||
          oldItems[i].tag !== newItems[i].tag ||
          oldItems[i].text !== newItems[i].text) {
        return true;
      }
    }
    return false;
  }

  async _parseFile(filePath) {
    return new Promise((resolve, reject) => {
      const items = [];
      const stream = createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
      });

      let lineNumber = 0;

      rl.on('line', (line) => {
        this.regex.lastIndex = 0;
        let match;
        while ((match = this.regex.exec(line)) !== null) {
          const tag = match[1].toUpperCase();
          if (todoConfig.tagSet.has(tag)) {
            items.push(new TodoItem(tag, match[2].trim(), lineNumber, match.index, filePath));
          }
        }
        lineNumber++;
      });

      rl.on('close', () => resolve(items));
      rl.on('error', (err) => { stream.destroy(); reject(err); });
    });
  }

  _setupWatchers() {
    const watcher = vscode.workspace.createFileSystemWatcher(WATCHER_GLOB);

    this.context.subscriptions.push(
      watcher,
      watcher.onDidChange(uri => this._handleFileChange(uri.fsPath)),
      watcher.onDidCreate(uri => this._handleFileChange(uri.fsPath)),
      watcher.onDidDelete(uri => this._handleFileDelete(uri.fsPath)),

      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) this._applyHighlights(editor);
      }),

      vscode.workspace.onDidChangeTextDocument(event => {
        this._handleDocumentChange(event.document);
      }),

      vscode.workspace.onDidSaveTextDocument(document => {
        this._handleDocumentSave(document);
      }),

      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('codeTODO')) {
          this._loadConfig();
          this.fileMap.clear();
          this.cache.clear();
          this.treeNeedsRebuild = true;
          this.startScan();
        }
      })
    );
  }

  _handleFileChange(filePath) {
    if (!this._shouldProcessFile(filePath)) return;

    const timer = this.updateTimers.get(filePath);
    if (timer) clearTimeout(timer);

    this.updateTimers.set(filePath, setTimeout(async () => {
      try {
        const changed = await this._processFile(filePath);
        if (changed) {
          this.treeNeedsRebuild = true;
          this._debouncedRefresh();
          this._debouncedSaveCache();
        }
      } catch (error) {
        console.error(`Error updating ${filePath}:`, error);
      }
    }, 300));
  }

  _handleFileDelete(filePath) {
    const oldItems = this.fileMap.get(filePath);
    if (!oldItems) return;

    this.fileMap.delete(filePath);
    this.cache.delete(filePath);
    this.treeNeedsRebuild = true;
    this._updateStatsIncremental(oldItems, []);
    this._debouncedRefresh();
  }

  _shouldProcessFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' ||
        ext === '.svg' || ext === '.ico' || ext === '.woff' || ext === '.woff2' ||
        ext === '.ttf' || ext === '.eot' || ext === '.otf' || ext === '.pdf' ||
        ext === '.zip' || ext === '.tar' || ext === '.gz') return false;

    if (ext === '.js' || ext === '.css') {
      if (filePath.endsWith('.min.js') || filePath.endsWith('.min.css')) return false;
    }
    if (filePath.endsWith('.map') ||
        filePath.endsWith('package-lock.json') ||
        filePath.endsWith('yarn.lock') ||
        filePath.endsWith('pnpm-lock.yaml')) return false;

    return true;
  }

  _handleDocumentChange(document) {
    if (!this._shouldProcessFile(document.uri.fsPath)) return;
    const filePath = document.uri.fsPath;
    const timer = this.docTimers.get(filePath);
    if (timer) clearTimeout(timer);
    this.docTimers.set(filePath, setTimeout(() => {
      this.docTimers.delete(filePath);
      this._processDocumentInMemory(document);
    }, 150));
  }

  _handleDocumentSave(document) {
    if (!this._shouldProcessFile(document.uri.fsPath)) return;
    this._processDocumentFromFile(document.uri.fsPath);
  }

  async _processDocumentInMemory(document) {
    try {
      const filePath = document.uri.fsPath;
      const content = document.getText();
      const items = this._parseContent(content, filePath);
      this._updateFileMap(filePath, items);

      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.fsPath === filePath) {
        this._applyHighlights(editor);
      }

      this._debouncedRefresh();
    } catch (error) {
      console.error('Error processing document in memory:', error);
    }
  }

  async _processDocumentFromFile(filePath) {
    try {
      const changed = await this._processFile(filePath);
      if (changed) {
        this._debouncedRefresh();
        this._debouncedSaveCache();
      }
    } catch (error) {
      console.error('Error processing document from file:', error);
    }
  }

  _parseContent(content, filePath) {
    const items = [];
    const lines = content.split('\n');
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
      this.regex.lastIndex = 0;
      let match;
      const line = lines[lineNumber];
      while ((match = this.regex.exec(line)) !== null) {
        const tag = match[1].toUpperCase();
        if (todoConfig.tagSet.has(tag)) {
          items.push(new TodoItem(tag, match[2].trim(), lineNumber, match.index, filePath));
        }
      }
    }
    return items;
  }

  _applyHighlightsToActiveEditor() {
    const editor = vscode.window.activeTextEditor;
    if (editor) this._applyHighlights(editor);
  }

  _applyHighlights(editor) {
    if (!editor) return;
    const doc = editor.document;
    const items = this._parseContent(doc.getText(), doc.uri.fsPath);
    if (items.length === 0) {
      editor.setDecorations(this.decorationType, []);
      return;
    }
    const ranges = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      ranges[i] = items[i].range;
    }
    editor.setDecorations(this.decorationType, ranges);
  }

  _updateStatsIncremental(oldItems, newItems) {
    for (let i = 0; i < oldItems.length; i++) {
      const tag = oldItems[i].tag;
      if (this.totalsByTag[tag] > 1) {
        this.totalsByTag[tag]--;
      } else {
        delete this.totalsByTag[tag];
      }
      this.totalTodos--;
    }
    for (let i = 0; i < newItems.length; i++) {
      const tag = newItems[i].tag;
      this.totalsByTag[tag] = (this.totalsByTag[tag] || 0) + 1;
      this.totalTodos++;
    }
    this._updateStatusBar();
  }

  _updateStats() {
    this.totalsByTag = {};
    this.totalTodos = 0;
    for (const items of this.fileMap.values()) {
      for (let i = 0; i < items.length; i++) {
        const tag = items[i].tag;
        this.totalsByTag[tag] = (this.totalsByTag[tag] || 0) + 1;
        this.totalTodos++;
      }
    }
    this._updateStatusBar();
  }

  _updateStatusBar() {
    const entries = Object.entries(this.totalsByTag);
    if (entries.length === 0) {
      this.statusBarItem.text = '$(checklist) No TODOs found';
      this.statusBarItem.show();
      return;
    }
    const tagOrder = todoConfig.tags;
    entries.sort(([a], [b]) => tagOrder.indexOf(a) - tagOrder.indexOf(b));
    const parts = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) {
      parts[i] = `${entries[i][0]}:${entries[i][1]}`;
    }
    this.statusBarItem.text = `$(checklist) ${parts.join(' | ')}`;
    this.statusBarItem.show();
  }

  _debouncedRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.treeNeedsRebuild = true;
      this._onDidChangeTreeData.fire();
    }, 50);
  }

  _debouncedSaveCache() {
    if (this.saveCacheTimer) clearTimeout(this.saveCacheTimer);
    this.saveCacheTimer = setTimeout(() => {
      this.saveCacheTimer = null;
      this._saveCache();
    }, 2000);
  }

  refresh() {
    this._debouncedRefresh();
  }

  async _saveCache() {
    try {
      const cacheData = Object.fromEntries(this.cache);
      await this.context.globalState.update(`todoCache_v${CACHE_VERSION}`, cacheData);
    } catch (error) {
      console.error('Cache save error:', error);
    }
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (element) {
      if (element.contextValue === 'tag' && !element.children) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot) {
          const structure = this._tagStructures.get(element.tag);
          if (structure) {
            const result = this._buildTreeFromStructure(structure, workspaceRoot);
            element.children = result.nodes;
          }
        }
      }
      return element.children || [];
    }
    return this._buildTree();
  }

  _buildTree() {
    if (!this.treeNeedsRebuild && this.cachedTree.length > 0) {
      return this.cachedTree;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return [];

    this._tagStructures = new Map();
    for (let t = 0; t < todoConfig.tags.length; t++) {
      this._tagStructures.set(todoConfig.tags[t], new Map());
    }

    for (const [filePath, items] of this.fileMap) {
      if (!filePath.startsWith(workspaceRoot)) continue;

      const relativePath = path.relative(workspaceRoot, filePath);
      const pathParts = relativePath.split(path.sep);
      const fileName = pathParts.pop();

      const itemsByTag = new Map();
      for (let i = 0; i < items.length; i++) {
        const tag = items[i].tag;
        if (!itemsByTag.has(tag)) itemsByTag.set(tag, []);
        itemsByTag.get(tag).push(items[i]);
      }

      for (const [tag, tagItems] of itemsByTag) {
        const structure = this._tagStructures.get(tag);
        if (!structure) continue;

        let currentLevel = structure;
        let currentPath = workspaceRoot;

        for (let i = 0; i < pathParts.length; i++) {
          const part = pathParts[i];
          currentPath = path.join(currentPath, part);
          if (!currentLevel.has(part)) {
            currentLevel.set(part, { path: currentPath, children: new Map() });
          }
          currentLevel = currentLevel.get(part).children;
        }

        let fileMap = currentLevel.get('__files__');
        if (!fileMap) {
          fileMap = new Map();
          currentLevel.set('__files__', fileMap);
        }
        fileMap.set(fileName, { filePath, items: tagItems });
      }
    }

    const rootNodes = [];
    for (let t = 0; t < todoConfig.tags.length; t++) {
      const tag = todoConfig.tags[t];
      const count = this.totalsByTag[tag];
      if (count > 0) {
        rootNodes.push({
          label: `${tag} (${count})`,
          tag: tag,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          iconPath: new vscode.ThemeIcon(TAG_ICONS[tag] || 'comment'),
          children: null,
          contextValue: 'tag'
        });
      }
    }

    this.cachedTree = rootNodes;
    this.treeNeedsRebuild = false;
    return this.cachedTree;
  }

  _buildTreeFromStructure(structure, workspaceRoot) {
    const nodes = [];
    let totalCount = 0;

    for (const [key, value] of structure) {
      if (key === '__files__') {
        for (const [fileName, fileData] of value) {
          const count = fileData.items.length;
          if (count === 0) continue;
          totalCount += count;

          const children = new Array(count);
          for (let i = 0; i < count; i++) {
            const item = fileData.items[i];
            children[i] = {
              label: item.text || item.tag,
              description: `[${item.tag}]  Ln ${item.line + 1}`,
              command: {
                command: "vscode.open",
                title: "Open File",
                arguments: [
                  vscode.Uri.file(fileData.filePath),
                  { selection: new vscode.Range(item.line, 0, item.line, 0) }
                ]
              },
              iconPath: new vscode.ThemeIcon(TAG_ICONS[item.tag] || 'comment'),
              contextValue: 'todo'
            };
          }

          nodes.push({
            label: `${fileName} (${count})`,
            tooltip: path.relative(workspaceRoot, fileData.filePath),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            iconPath: vscode.ThemeIcon.File,
            children: children,
            contextValue: 'file'
          });
        }
      } else {
        const childResult = this._buildTreeFromStructure(value.children, workspaceRoot);
        if (childResult.nodes.length === 0) continue;

        totalCount += childResult.count;

        nodes.push({
          label: `${key} (${childResult.count})`,
          tooltip: path.relative(workspaceRoot, value.path),
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          iconPath: vscode.ThemeIcon.Folder,
          children: childResult.nodes,
          contextValue: 'folder'
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.contextValue === 'folder' && b.contextValue !== 'folder') return -1;
      if (a.contextValue !== 'folder' && b.contextValue === 'folder') return 1;
      return a.label.localeCompare(b.label);
    });

    return { nodes, count: totalCount };
  }
}

function activate(context) {
  const provider = new TodoTreeProvider(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("todoTreeView", provider),
    vscode.commands.registerCommand("codeTODO.refresh", async () => {
      provider.fileMap.clear();
      provider.cache.clear();
      provider.treeNeedsRebuild = true;
      await provider.startScan();
    })
  );

  return provider;
}

function deactivate() { }

module.exports = { activate, deactivate };
