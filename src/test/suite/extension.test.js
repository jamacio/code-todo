const assert = require('assert');
const vscode = require('vscode');
const path = require('path');

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Starting all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('JamacioRocha.code-todo'));
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands();
        assert.ok(commands.includes('codeTODO.refresh'));
    });

    test('TODO pattern analysis', () => {
        const tagPattern = /\b(BUG|HACK|FIXME|TODO|XXX)(?=\s|:)[:]?\s*(.*)/g;

        // Test TODO detection
        const todoText = "// TODO: Implement this function";
        const todoMatch = tagPattern.exec(todoText);
        assert.strictEqual(todoMatch[1], 'TODO');
        assert.strictEqual(todoMatch[2], 'Implement this function');

        // Reset regex
        tagPattern.lastIndex = 0;

        // Test FIXME detection
        const fixmeText = "// FIXME: Fix this bug";
        const fixmeMatch = tagPattern.exec(fixmeText);
        assert.strictEqual(fixmeMatch[1], 'FIXME');
        assert.strictEqual(fixmeMatch[2], 'Fix this bug');

        // Reset regex
        tagPattern.lastIndex = 0;

        // Test BUG detection
        const bugText = "// BUG: There is a problem here";
        const bugMatch = tagPattern.exec(bugText);
        assert.strictEqual(bugMatch[1], 'BUG');
        assert.strictEqual(bugMatch[2], 'There is a problem here');
    });

    test('File extension validation', () => {
        const validExtensions = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.php', '.py', '.java', '.cs', '.cpp', '.h', '.hpp', '.html', '.css', '.scss', '.md', '.txt', '.yaml', '.yml', '.json'];
        const invalidExtensions = ['.png', '.jpg', '.gif', '.svg', '.ico', '.woff', '.ttf'];

        // Simulated function for testing
        function shouldProcessFile(filePath) {
            const ignoredExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
            const ext = path.extname(filePath).toLowerCase();
            return !ignoredExtensions.includes(ext);
        }

        // Test valid extensions
        validExtensions.forEach(ext => {
            assert.ok(shouldProcessFile(`test${ext}`), `Extension ${ext} should be processed`);
        });

        // Test invalid extensions
        invalidExtensions.forEach(ext => {
            assert.ok(!shouldProcessFile(`test${ext}`), `Extension ${ext} should not be processed`);
        });
    });
});