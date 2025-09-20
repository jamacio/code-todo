# Code TODO - Test Documentation

This file provides comprehensive information about running tests for the Code TODO extension.

## Test Files Overview

### Main Test File: `src/test/suite/extension.test.js`

Contains 4 main test suites:

#### 1. Extension Presence Test

- **Purpose**: Verifies that the extension is properly loaded in VS Code
- **What it checks**: Extension with ID `JamacioRocha.code-todo` exists

#### 2. Command Registration Test

- **Purpose**: Ensures extension commands are properly registered
- **What it checks**: `codeTODO.refresh` command is available in VS Code

#### 3. TODO Pattern Analysis Test

- **Purpose**: Validates the regex pattern for detecting TODO tags
- **What it tests**:
  - `TODO: Implement this function` → Tag: `TODO`, Text: `Implement this function`
  - `FIXME: Fix this bug` → Tag: `FIXME`, Text: `Fix this bug`
  - `BUG: There is a problem here` → Tag: `BUG`, Text: `There is a problem here`

#### 4. File Extension Validation Test

- **Purpose**: Ensures only valid file types are processed
- **What it validates**:
  - ✅ **Processed**: `.js`, `.ts`, `.jsx`, `.tsx`, `.vue`, `.php`, `.py`, `.java`, `.cs`, `.cpp`, `.h`, `.hpp`, `.html`, `.css`, `.scss`, `.md`, `.txt`, `.yaml`, `.yml`, `.json`
  - ❌ **Ignored**: `.png`, `.jpg`, `.gif`, `.svg`, `.ico`, `.woff`, `.ttf`

## Running Tests

### Command Line

```bash
npm test
```

### VS Code Integration

1. Open Command Palette (`Ctrl+Shift+P`)
2. Type: `Tasks: Run Task`
3. Select: `npm: test`

### Debug Mode

1. Go to Run and Debug panel (`Ctrl+Shift+D`)
2. Select `Extension Tests` configuration
3. Click play button ▶️

## Expected Output

```
Extension Test Suite
  ✔ Extension should be present
  ✔ Commands should be registered
  ✔ TODO pattern analysis
  ✔ File extension validation
4 passing (20ms)
```

## Test Infrastructure

- **Framework**: Mocha with TDD interface
- **VS Code Integration**: `@vscode/test-electron`
- **File Discovery**: Uses `glob` to find test files
- **Pattern**: All `*.test.js` files in `src/test/` directory

## Adding New Tests

Create new `.test.js` files in `src/test/suite/` directory:

```javascript
const assert = require("assert");
const vscode = require("vscode");

suite("My Test Suite", () => {
  test("Should test something", () => {
    assert.strictEqual(true, true);
  });
});
```

## CI/CD Integration

The test command returns appropriate exit codes:

- **0**: All tests passed
- **1**: One or more tests failed

Perfect for continuous integration pipelines.
