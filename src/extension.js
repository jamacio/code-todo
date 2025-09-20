// © 2025 Jamácio Rocha - Licensed under Non-Commercial OSS
const vscode = require('vscode');
const path = require('path');
const fs = require('fs').promises;
const { createReadStream } = require('fs');
const readline = require('readline');

const TAGS = ['BUG', 'HACK', 'FIXME', 'TODO', 'XXX'];
const TAG_PATTERN = `\\b(${TAGS.join('|')})(?=\\s|:)[:]?\\s*(.*)`;
const CACHE_VERSION = 42;

class TodoTreeProvider {
  constructor(context) {
    this.context = context;
    this.cache = new Map();
    this.fileMap = new Map();
    this.decorations = new Map();
    this.isScanning = false;
    this.documentChangeTimer = null;
    this.updateTimers = new Map();

    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 255, 255, 0.68)',
      color: 'rgba(0, 0, 0, 0.68)',
      border: '1px solid rgba(255, 255, 255, 0.68)',
      borderRadius: '3px',
      overviewRulerColor: 'yellow',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.initialize();
  }

  async initialize() {
    this.loadCacheSync();

    if (this.fileMap.size > 0) {
      this.refresh();
      this.applyHighlightsToActiveEditor();
    }

    this.setupWatchers();
    setTimeout(() => this.startScan(), 100);
  }

  loadCacheSync() {
    try {
      const cacheData = this.context.globalState.get(`todoCache_v${CACHE_VERSION}`) || {};

      Object.entries(cacheData).forEach(([filePath, entry]) => {
        if (entry?.items && Array.isArray(entry.items) && entry.items.length > 0) {
          this.cache.set(filePath, entry);
          this.fileMap.set(filePath, entry.items);
        }
      });
    } catch (error) {
      console.error('Cache load failed:', error);
    }
  }

  async startScan() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const uris = await vscode.workspace.findFiles(
        '**/*.{js,ts,jsx,tsx,vue,php,py,java,cs,cpp,h,hpp,html,css,scss,md,txt,yaml,yml,json}',
        '**/{node_modules,vendor,dist,out,build,.git,.vscode,coverage,tmp,temp,__pycache__}/**'
      );

      const filesToProcess = [];
      for (const uri of uris) {
        const filePath = uri.fsPath;
        try {
          const stats = await fs.stat(filePath);
          const cacheEntry = this.cache.get(filePath);

          if (!cacheEntry ||
            cacheEntry.mtime !== stats.mtimeMs ||
            cacheEntry.size !== stats.size) {
            filesToProcess.push(filePath);
          }
        } catch (error) {
          this.handleFileDelete(filePath);
        }
      }

      await this.processFilesInBatches(filesToProcess);
      await this.saveCache();

    } catch (error) {
      console.error('Scan failed:', error);
    } finally {
      this.isScanning = false;
    }
  }

  async processFilesInBatches(files) {
    const BATCH_SIZE = 10;
    let processed = 0;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (filePath) => {
        try {
          await this.processFile(filePath);
          processed++;

          if (processed % 20 === 0) {
            this.refresh();
          }
        } catch (error) {
          console.error(`Error processing ${filePath}:`, error);
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.refresh();
  }

  async processFile(filePath) {
    try {
      const stats = await fs.stat(filePath);

      if (stats.size > 2 * 1024 * 1024) return;

      const items = await this.parseFile(filePath);

      if (items.length > 0) {
        this.fileMap.set(filePath, items);
        this.cache.set(filePath, {
          mtime: stats.mtimeMs,
          size: stats.size,
          items: items
        });
      } else {
        this.fileMap.delete(filePath);
        this.cache.delete(filePath);
      }

      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.uri.fsPath === filePath) {
        this.applyHighlights(activeEditor);
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        this.handleFileDelete(filePath);
      }
      throw error;
    }
  }

  async parseFile(filePath) {
    return new Promise((resolve, reject) => {
      const items = [];
      const stream = createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
      });

      let lineNumber = 0;

      rl.on('line', (line) => {
        const regex = new RegExp(TAG_PATTERN, 'g');
        let match;

        while ((match = regex.exec(line)) !== null) {
          const tag = match[1].toUpperCase();
          const text = match[2].trim();

          if (TAGS.includes(tag)) {
            items.push({
              tag,
              text,
              line: lineNumber,
              column: match.index,
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

  setupWatchers() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');

    this.context.subscriptions.push(
      watcher,
      watcher.onDidChange(uri => this.handleFileChange(uri.fsPath)),
      watcher.onDidCreate(uri => this.handleFileChange(uri.fsPath)),
      watcher.onDidDelete(uri => this.handleFileDelete(uri.fsPath)),

      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.applyHighlights(editor);
        }
      }),

      vscode.workspace.onDidChangeTextDocument(event => {
        this.handleDocumentChange(event.document);
      }),

      vscode.workspace.onDidSaveTextDocument(document => {
        this.handleDocumentSave(document);
      })
    );
  }

  handleFileChange(filePath) {
    if (this.shouldProcessFile(filePath)) {
      this.debounceFileUpdate(filePath);
    }
  }

  debounceFileUpdate(filePath) {
    clearTimeout(this.updateTimers.get(filePath));

    this.updateTimers.set(filePath, setTimeout(async () => {
      try {
        await this.processFile(filePath);
        this.refresh();
        await this.saveCache();
      } catch (error) {
        console.error(`Error updating ${filePath}:`, error);
      }
    }, 1000)); // Larger debounce for file changes
  }

  handleFileDelete(filePath) {
    this.fileMap.delete(filePath);
    this.cache.delete(filePath);
    this.refresh();
  }

  shouldProcessFile(filePath) {
    const ignoredExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
    const ignoredFiles = [/\.min\.(js|css)$/, /\.map$/, /package-lock\.json$/, /yarn\.lock$/];

    const ext = path.extname(filePath).toLowerCase();
    if (ignoredExtensions.includes(ext)) return false;

    return !ignoredFiles.some(pattern => pattern.test(filePath));
  }

  handleDocumentChange(document) {
    if (!this.shouldProcessFile(document.uri.fsPath)) return;

    // Use debounce for real-time document changes
    clearTimeout(this.documentChangeTimer);
    this.documentChangeTimer = setTimeout(() => {
      this.processDocumentInMemory(document);
    }, 300); // Faster debounce for real-time changes
  }

  handleDocumentSave(document) {
    if (!this.shouldProcessFile(document.uri.fsPath)) return;

    // Process immediately on save
    this.processDocumentFromFile(document.uri.fsPath);
  }

  async processDocumentInMemory(document) {
    try {
      const filePath = document.uri.fsPath;
      const content = document.getText();

      // Parse content in memory (not saved yet)
      const items = this.parseContent(content, filePath);

      if (items.length > 0) {
        this.fileMap.set(filePath, items);
        // Don't update cache yet, only visualization
      } else {
        this.fileMap.delete(filePath);
      }

      // Apply highlights immediately
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document === document) {
        this.applyHighlights(activeEditor);
      }

      // Update the tree
      this.refresh();

    } catch (error) {
      console.error(`Error processing document in memory:`, error);
    }
  }

  async processDocumentFromFile(filePath) {
    try {
      await this.processFile(filePath);
      this.refresh();
      await this.saveCache();
    } catch (error) {
      console.error(`Error processing document from file:`, error);
    }
  }

  parseContent(content, filePath) {
    const items = [];
    const lines = content.split('\n');

    lines.forEach((line, lineNumber) => {
      const regex = new RegExp(TAG_PATTERN, 'g');
      let match;

      while ((match = regex.exec(line)) !== null) {
        const tag = match[1].toUpperCase();
        const text = match[2].trim();

        if (TAGS.includes(tag)) {
          items.push({
            tag,
            text,
            line: lineNumber,
            column: match.index,
            file: filePath
          });
        }
      }
    });

    return items;
  }

  applyHighlightsToActiveEditor() {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      this.applyHighlights(activeEditor);
    }
  }

  applyHighlights(editor) {
    if (!editor) return;

    const filePath = editor.document.uri.fsPath;
    const items = this.fileMap.get(filePath) || [];

    const oldDecorations = this.decorations.get(filePath) || [];
    oldDecorations.forEach(decoration => decoration.dispose());

    const ranges = items.map(item => new vscode.Range(
      new vscode.Position(item.line, item.column),
      new vscode.Position(item.line, item.column + item.tag.length)
    ));

    editor.setDecorations(this.decorationType, ranges);
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  async saveCache() {
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
      return element.children || [];
    }
    return this.buildTree();
  }

  buildTree() {
    const tree = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return tree;

    const folderStructure = new Map();

    this.fileMap.forEach((items, filePath) => {
      if (!filePath.startsWith(workspaceRoot)) return;

      const relativePath = path.relative(workspaceRoot, filePath);
      const pathParts = relativePath.split(path.sep);
      const fileName = pathParts.pop();

      let currentLevel = folderStructure;
      let currentPath = workspaceRoot;

      pathParts.forEach(part => {
        currentPath = path.join(currentPath, part);
        if (!currentLevel.has(part)) {
          currentLevel.set(part, {
            type: 'folder',
            path: currentPath,
            children: new Map(),
            files: new Map()
          });
        }
        currentLevel = currentLevel.get(part).children;
      });

      if (!currentLevel.has('__files__')) {
        currentLevel.set('__files__', new Map());
      }
      currentLevel.get('__files__').set(fileName, { filePath, items });
    });

    return this.buildTreeFromStructure(folderStructure, workspaceRoot);
  }

  buildTreeFromStructure(structure, basePath) {
    const nodes = [];

    structure.forEach((value, key) => {
      if (key === '__files__') {
        value.forEach((fileData, fileName) => {
          const fileNode = {
            label: fileName,
            tooltip: path.relative(vscode.workspace.workspaceFolders[0].uri.fsPath, fileData.filePath),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            iconPath: vscode.ThemeIcon.File,
            children: []
          };

          fileData.items.forEach(item => {
            fileNode.children.push({
              label: `[${item.tag}] ${item.text}`,
              description: `Line ${item.line + 1}`,
              command: {
                command: "vscode.open",
                title: "Open File",
                arguments: [
                  vscode.Uri.file(fileData.filePath),
                  { selection: new vscode.Range(item.line, 0, item.line, 0) }
                ]
              },
              iconPath: this.getIconForTag(item.tag)
            });
          });

          if (fileNode.children.length > 0) {
            nodes.push(fileNode);
          }
        });
      } else {
        const folderNode = {
          label: key,
          tooltip: path.relative(vscode.workspace.workspaceFolders[0].uri.fsPath, value.path),
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          iconPath: vscode.ThemeIcon.Folder,
          children: this.buildTreeFromStructure(value.children, value.path)
        };

        if (folderNode.children.length > 0) {
          nodes.push(folderNode);
        }
      }
    });

    return nodes.sort((a, b) => {
      if (a.iconPath.id === 'folder' && b.iconPath.id !== 'folder') return -1;
      if (a.iconPath.id !== 'folder' && b.iconPath.id === 'folder') return 1;
      return a.label.localeCompare(b.label);
    });
  }

  getIconForTag(tag) {
    const iconMap = {
      'TODO': new vscode.ThemeIcon('checklist'),
      'FIXME': new vscode.ThemeIcon('tools'),
      'BUG': new vscode.ThemeIcon('bug'),
      'HACK': new vscode.ThemeIcon('warning'),
      'XXX': new vscode.ThemeIcon('alert')
    };
    return iconMap[tag] || new vscode.ThemeIcon('comment');
  }
}

function activate(context) {
  const provider = new TodoTreeProvider(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("todoTreeView", provider),
    vscode.commands.registerCommand("codeTODO.refresh", async () => {
      provider.fileMap.clear();
      provider.cache.clear();
      await provider.startScan();
    })
  );

  return provider;
}

function deactivate() { }

module.exports = { activate, deactivate };
