import * as vscode from "vscode";
import * as path from "path";

const TAGS = ["BUG", "HACK", "FIXME", "TODO", "XXX"];

export function activate(context: vscode.ExtensionContext) {
  const provider = new TodoProvider(context);
  vscode.window.registerTreeDataProvider("todoTreeView", provider);
  context.subscriptions.push(
    vscode.commands.registerCommand("todoTreeSimple.refresh", () =>
      provider.refresh()
    )
  );

  provider.refresh();

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => provider.refreshFile(doc))
  );
}

class NodeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly resourceUri?: vscode.Uri
  ) {
    super(label, collapsibleState);
    if (resourceUri) {
      this.resourceUri = resourceUri;
    }
  }
}

class TodoItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly file: vscode.Uri,
    public readonly line: number
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: "vscode.open",
      title: "Open Code TODO",
      arguments: [file, { selection: new vscode.Range(line, 0, line, 0) }],
    };
    this.description = `${line + 1}`;
    this.tooltip = `${path.basename(file.fsPath)}:${line + 1}`;
    this.iconPath = undefined;
  }
}

export function deactivate() {}

class TodoProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor(
      "editor.wordHighlightStrongBackground"
    ),
  });

  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private cache: { [file: string]: { label: string; line: number }[] } = {};
  private fileMap = new Map<string, TodoItem[]>();
  private tree: NodeItem[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.cache = this.context.globalState.get("todoCache", {});
    for (const [filePath, todos] of Object.entries(this.cache)) {
      const uri = vscode.Uri.file(filePath);
      this.fileMap.set(
        filePath,
        todos.map((t) => new TodoItem(t.label, uri, t.line))
      );
    }
    this.buildTree();

    vscode.window.onDidChangeActiveTextEditor(() => {
      this.applyHighlights();
    });
  }

  private buildTree() {
    const root = new Map<string, any>();
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders) {
      this.tree = [];
      return;
    }
    const rootPath = wsFolders[0].uri.fsPath;

    for (const [filePath, items] of this.fileMap) {
      const rel = path.relative(rootPath, filePath);
      const parts = rel.split(path.sep);
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!current.has(part)) {
          current.set(part, {
            children: new Map(),
            items: undefined,
            uri: undefined,
          });
        }
        const node = current.get(part);
        if (i === parts.length - 1) {
          node.items = items;
          node.uri = vscode.Uri.file(filePath);
        }
        current = node.children;
      }
    }

    const convert = (map: Map<string, any>): NodeItem[] => {
      const result: NodeItem[] = [];
      for (const [name, info] of map.entries()) {
        if (info.items) {
          const fileNode = new NodeItem(
            name,
            vscode.TreeItemCollapsibleState.Collapsed,
            info.uri
          );
          fileNode.contextValue = "file";
          fileNode.iconPath = new vscode.ThemeIcon("file");

          (fileNode as any).todos = info.items;
          result.push(fileNode);
        } else {
          const folderNode = new NodeItem(
            name,
            vscode.TreeItemCollapsibleState.Collapsed
          );
          (folderNode as any).children = convert(info.children);
          result.push(folderNode);
        }
      }

      result.sort((a, b) => {
        const aLabel =
          typeof a.label === "string"
            ? a.label
            : (a.label as vscode.TreeItemLabel).label;
        const bLabel =
          typeof b.label === "string"
            ? b.label
            : (b.label as vscode.TreeItemLabel).label;
        return aLabel.localeCompare(bLabel);
      });
      return result;
    };

    this.tree = convert(root);
  }

  async refresh(): Promise<void> {
    this._onDidChange.fire(undefined);
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "Scanning Code TODOs...",
      },
      async () => {
        this.fileMap.clear();
        const pattern = new RegExp(`\\b(${TAGS.join("|")})[:]?`);
        const uris = await vscode.workspace.findFiles(
          "**/*.{ts,js,jsx,tsx,php,py,java,php}",
          "**/{vendor,node_modules,out,dist,build,lib,generated}/**"
        );
        const newCache: typeof this.cache = {};
        const wsFolders = vscode.workspace.workspaceFolders;
        if (!wsFolders) {
          return;
        }

        for (const uri of uris) {
          const doc = await vscode.workspace.openTextDocument(uri);
          const items: TodoItem[] = [];
          for (let i = 0; i < doc.lineCount; i++) {
            const text = doc.lineAt(i).text;
            if (pattern.test(text)) {
              const match = text.match(pattern);
              if (match) {
                const tag = match[1];
                const label = text
                  .replace(
                    new RegExp(`^.*?\\b(?:${TAGS.join("|")})[:]?\s*`, "i"),
                    ""
                  )
                  .trim();
                items.push(new TodoItem(`[${tag}] ${label}`, uri, i));
              }
            }
          }
          if (items.length) {
            this.fileMap.set(uri.fsPath, items);
            newCache[uri.fsPath] = items.map((i) => ({
              label: i.label,
              line: i.line,
            }));
            this.buildTree();
            this._onDidChange.fire(undefined);
          }
        }
        await this.context.globalState.update("todoCache", newCache);
        this.applyHighlights();
      }
    );
  }

  async refreshFile(doc: vscode.TextDocument): Promise<void> {
    const pattern = new RegExp(`\\b(${TAGS.join("|")})[:]?`);
    const uri = doc.uri;
    const items: TodoItem[] = [];

    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;
      if (pattern.test(text)) {
        const match = text.match(pattern);
        if (match) {
          const tag = match[1];
          const label = text
            .replace(new RegExp(`^.*?\\b(?:${TAGS.join("|")})[:]?\s*`, "i"), "")
            .trim();
          items.push(new TodoItem(`[${tag}] ${label}`, uri, i));
        }
      }
    }

    if (items.length) {
      this.fileMap.set(uri.fsPath, items);
      this.cache[uri.fsPath] = items.map((i) => ({
        label: i.label,
        line: i.line,
      }));
    } else {
      this.fileMap.delete(uri.fsPath);
      delete this.cache[uri.fsPath];
    }

    this.buildTree();
    this._onDidChange.fire(undefined);

    await this.context.globalState.update("todoCache", this.cache);
    this.applyHighlights();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (!element) {
      return Promise.resolve(this.tree);
    }
    const anyEl = element as any;
    if (anyEl.children) {
      return Promise.resolve(anyEl.children as vscode.TreeItem[]);
    }
    if (anyEl.todos) {
      return Promise.resolve(anyEl.todos as vscode.TreeItem[]);
    }
    return Promise.resolve([]);
  }

  private applyHighlights() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const uri = editor.document.uri.fsPath;
    const todos = this.fileMap.get(uri);
    if (!todos) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const ranges = todos.map((t) => new vscode.Range(t.line, 0, t.line, 1000));
    editor.setDecorations(this.decorationType, ranges);
  }
}
