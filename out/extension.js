"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const path = require("path");
const TAGS = ["BUG", "HACK", "FIXME", "TODO", "XXX"];
function activate(context) {
    const provider = new TodoProvider(context);
    vscode.window.registerTreeDataProvider("todoTreeView", provider);
    context.subscriptions.push(vscode.commands.registerCommand("codeTODO.refresh", () => provider.refresh()));
    provider.refresh();
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => provider.refreshFile(doc)));
}
class NodeItem extends vscode.TreeItem {
    constructor(label, collapsibleState, resourceUri) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.resourceUri = resourceUri;
        if (resourceUri) {
            this.resourceUri = resourceUri;
        }
    }
}
class TodoItem extends vscode.TreeItem {
    constructor(label, file, line) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.label = label;
        this.file = file;
        this.line = line;
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
function deactivate() { }
class TodoProvider {
    constructor(context) {
        this.context = context;
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor("editor.wordHighlightStrongBackground"),
        });
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChange.event;
        this.cache = {};
        this.fileMap = new Map();
        this.tree = [];
        this.cache = this.context.globalState.get("todoCache", {});
        for (const [filePath, todos] of Object.entries(this.cache)) {
            const uri = vscode.Uri.file(filePath);
            this.fileMap.set(filePath, todos.map((t) => new TodoItem(t.label, uri, t.line)));
        }
        this.buildTree();
        vscode.window.onDidChangeActiveTextEditor(() => {
            this.applyHighlights();
        });
    }
    buildTree() {
        const root = new Map();
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
        const convert = (map) => {
            const result = [];
            for (const [name, info] of map.entries()) {
                if (info.items) {
                    const fileNode = new NodeItem(name, vscode.TreeItemCollapsibleState.Collapsed, info.uri);
                    fileNode.contextValue = "file";
                    fileNode.iconPath = new vscode.ThemeIcon("file");
                    fileNode.todos = info.items;
                    result.push(fileNode);
                }
                else {
                    const folderNode = new NodeItem(name, vscode.TreeItemCollapsibleState.Collapsed);
                    folderNode.children = convert(info.children);
                    result.push(folderNode);
                }
            }
            result.sort((a, b) => {
                const aLabel = typeof a.label === "string"
                    ? a.label
                    : a.label.label;
                const bLabel = typeof b.label === "string"
                    ? b.label
                    : b.label.label;
                return aLabel.localeCompare(bLabel);
            });
            return result;
        };
        this.tree = convert(root);
    }
    refresh() {
        return __awaiter(this, void 0, void 0, function* () {
            this._onDidChange.fire(undefined);
            yield vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: "Scanning Code TODOs...",
            }, () => __awaiter(this, void 0, void 0, function* () {
                this.fileMap.clear();
                const pattern = new RegExp(`\\b(${TAGS.join("|")})[:]?`);
                const uris = yield vscode.workspace.findFiles("**/*.{ts,js,jsx,tsx,php,py,java,php}", "**/{vendor,node_modules,out,dist,build,lib,generated}/**");
                const newCache = {};
                const wsFolders = vscode.workspace.workspaceFolders;
                if (!wsFolders) {
                    return;
                }
                for (const uri of uris) {
                    const doc = yield vscode.workspace.openTextDocument(uri);
                    const items = [];
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
                        newCache[uri.fsPath] = items.map((i) => ({
                            label: i.label,
                            line: i.line,
                        }));
                        this.buildTree();
                        this._onDidChange.fire(undefined);
                    }
                }
                yield this.context.globalState.update("todoCache", newCache);
                this.applyHighlights();
            }));
        });
    }
    refreshFile(doc) {
        return __awaiter(this, void 0, void 0, function* () {
            const pattern = new RegExp(`\\b(${TAGS.join("|")})[:]?`);
            const uri = doc.uri;
            const items = [];
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
            }
            else {
                this.fileMap.delete(uri.fsPath);
                delete this.cache[uri.fsPath];
            }
            this.buildTree();
            this._onDidChange.fire(undefined);
            yield this.context.globalState.update("todoCache", this.cache);
            this.applyHighlights();
        });
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            return Promise.resolve(this.tree);
        }
        const anyEl = element;
        if (anyEl.children) {
            return Promise.resolve(anyEl.children);
        }
        if (anyEl.todos) {
            return Promise.resolve(anyEl.todos);
        }
        return Promise.resolve([]);
    }
    applyHighlights() {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
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
//# sourceMappingURL=extension.js.map