# 🧪 How to Run Tests

This project includes automated tests to ensure the extension works correctly.

## ✅ **Methods to Run Tests**

### **1. Via Terminal (Command Line)**

```bash
npm test
```

### **2. Via VS Code Tasks**

- Press `Ctrl+Shift+P`
- Type: `Tasks: Run Task`
- Select: `npm: test`

### **3. Via VS Code Debugger**

- Open the Run and Debug panel (`Ctrl+Shift+D`)
- Select the `Extension Tests` configuration
- Click the play button ▶️

### **4. Using Test Explorer (VS Code)**

- Install the "Test Explorer UI" extension if you don't have it
- Tests will appear in the VS Code test panel

## 📋 **What the Tests Verify**

### **Test 1: Extension should be present**

✅ Verifies that the extension is loaded correctly in VS Code

### **Test 2: Commands should be registered**

✅ Confirms that the `codeTODO.refresh` command is available

### **Test 3: TODO pattern analysis**

✅ Tests if the regex correctly detects:

- `TODO: text`
- `FIXME: text`
- `BUG: text`
- `HACK: text`
- `XXX: text`

### **Test 4: File extension validation**

✅ Verifies that only valid files are processed:

- ✅ Processes: `.js`, `.ts`, `.jsx`, `.tsx`, `.php`, `.py`, etc.
- ❌ Ignores: `.png`, `.jpg`, `.gif`, `.svg`, `.ico`, etc.

## 🔧 **Test Structure**

```
src/test/
├── runTest.js           # Main script to run tests
├── suite/
│   ├── index.js         # Mocha configuration
│   └── extension.test.js # Extension tests
```

## 📊 **Example Output**

```
Extension Test Suite
  ✔ Extension should be present
  ✔ Commands should be registered
  ✔ TODO pattern analysis
  ✔ File extension validation
4 passing (38ms)
```

## 🛠️ **Adding New Tests**

To add new tests, create `.test.js` files in the `src/test/suite/` folder.

Example:

```javascript
const assert = require("assert");
const vscode = require("vscode");

suite("My New Test", () => {
  test("Should do something specific", () => {
    // Your test code here
    assert.strictEqual(1 + 1, 2);
  });
});
```

## 🚀 **Running Tests in CI/CD**

For continuous integration, use:

```bash
npm run test
```

The command returns:

- **Exit Code 0**: All tests passed ✅
- **Exit Code 1**: Some test failed ❌
