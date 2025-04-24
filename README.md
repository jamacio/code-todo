# 🧭 Code TODO

> A simple and efficient extension to list and highlight tags like TODO, FIXME, BUG, HACK, and XXX in Visual Studio Code.

## ✨ Features

- 🔍 Scans code files for comments with tags such as:
  - `TODO`
  - `FIXME`
  - `BUG`
  - `HACK`
  - `XXX`
- 📁 Displays these comments organized in a tree by files and folders.
- 🎯 Visual highlight on the editor line with the comment.
- 🧠 Persistent cache between sessions.
- 🔄 Automatic update when saving the file.

---

## 🚀 Installation

1. Open **Visual Studio Code**.
2. Go to the **Extensions (Ctrl+Shift+X)** tab.
3. Search for `JamacioRocha.code-todo`.
4. Click **Install**.

## 🌐 Extension Page

[Click here to visit the Code TODO extension page on the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=JamacioRocha.code-todo)

---

## 🛠️ How to Use

1. Add comments with the tags in your code:
   ```js
   // TODO: refactor this
   // BUG: doesn't work on Firefox
   // HACK ugly but necessary
   // FIXME: needs null handling here
   // XXX: watch out for performance
   ```
2. Open the `Code TODO` side panel (icon in the sidebar).
3. View all comments organized by folder/file.
4. Click on a tree item to jump directly to the corresponding line in the editor.

```
src/
 └── auth/
         └── login.ts
                 ├── [TODO] implement login function (line 3)
                 ├── [BUG] error loading user (line 4)
                 ├── [HACK] temporary solution... (line 5)
                 ├── [FIXME] remove console.log (line 6)
                 └── [XXX] critical performance... (line 7)
```

---

## 📂 Language Support

The extension scans files with the following extensions:

- `.ts`, `.js`, `.jsx`, `.tsx`, `.php`, `.py`, `.java`

Files inside `node_modules`, `vendor`, and `out` are ignored by default.

---

## 🧪 Internal Functionality

### 1. Activation

When the extension is activated:

- Registers a tree provider (`TreeDataProvider`).
- Performs an initial scan of the project files.
- Monitors file saves to update the tree in real-time.

### 2. Scanning

For each supported file, it:

- Reads all lines of the document.
- Applies a regex looking for: `TODO`, `FIXME`, `BUG`, `HACK`, `XXX`.
- For each occurrence, creates an item of type `TodoItem`.

### 3. Organization

The results are grouped by folder and file structure, forming a navigable tree in the side panel.

### 4. Highlighting

When a file with tags is open:

- Lines with comments are highlighted with a custom background color.

---

## 🔄 Available Command

- `codeTODO.refresh`: Rescans the project and updates the TODO tree manually.

---

## 💡 Notes on Tags

- `// TODO:` — something that still needs to be done.
- `// BUG:` — points to a known bug or issue.
- `// FIXME:` — something wrong that needs fixing.
- `// HACK:` — workaround or temporary solution.
- `// XXX:` — special attention to dangerous or sensitive code.

---

## 📝 License

MIT © [Jamácio Rocha](https://github.com/jamacio)
