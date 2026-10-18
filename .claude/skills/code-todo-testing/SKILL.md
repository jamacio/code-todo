---
name: code-todo-testing
description: Como rodar, depurar e escrever testes da extensão Code TODO — suíte Mocha (TDD) executada dentro de um VS Code real via @vscode/test-electron, incluindo execução headless no Linux e como testar a lógica real de src/extension.js. Use quando o usuário pedir para rodar testes, adicionar/corrigir testes, investigar falha de `npm test` ou validar uma mudança na extensão.
---

# Testes do Code TODO

## Estrutura

```
src/test/
├── runTest.js              # baixa um VS Code em .vscode-test/ e roda a suíte com a extensão carregada
└── suite/
    ├── index.js            # Mocha ui:'tdd', glob '**/**.test.js' a partir de src/test/
    └── extension.test.js   # 4 testes: extensão presente, comando registrado, regex, filtro de extensões
```

- Interface **TDD**: use `suite()` / `test()` / `suiteSetup()` / `setup()` — não `describe`/`it`.
- Qualquer arquivo `*.test.js` sob `src/test/` é carregado automaticamente.
- Os testes rodam no Extension Host, então `require('vscode')` funciona.

## Rodar

```bash
npm test          # pretest = npm run compile (webpack), depois node ./src/test/runTest.js
```

- Primeira execução baixa o VS Code para `.vscode-test/` (ignorado no git) — precisa de internet.
- **Rodando de dentro do VS Code** (terminal integrado / Claude Code na extensão): a variável `ELECTRON_RUN_AS_NODE=1` faz o VS Code de teste falhar com `bad option: --extensionTestsPath`. Use `env -u ELECTRON_RUN_AS_NODE npm test`.
- A extensão ativa em `onStartupFinished`, que pode ainda não ter ocorrido quando a suíte começa: testes que dependem dela devem chamar `await vscode.extensions.getExtension('JamacioRocha.code-todo').activate()` antes (como faz "Commands should be registered").
- **Linux sem display** (SSH/CI/sandbox): use `xvfb-run -a npm test`. Se o VS Code já estiver aberto com a mesma versão, pode falhar por instância duplicada; rodar via xvfb ou fechar resolve.
- Dentro do VS Code: Task `npm: test` ou configuração de debug **Extension Tests** (`.vscode/launch.json`).
- Para testar manualmente: configuração **Run Extension** (F5) abre um Extension Development Host.

Saída esperada: `4 passing`. Exit code 0 = sucesso, 1 = falha.

## Limitação importante da suíte atual

Os testes de regex e de extensões **copiam** a lógica em vez de usar o código real (a regex do teste só tem 5 tags; o filtro simulado difere de `_shouldProcessFile`). Logo, alterar `src/extension.js` não quebra esses testes. Ao escrever testes novos, prefira exercitar o código real:

```javascript
const assert = require('assert');
const vscode = require('vscode');

suite('TodoTreeProvider', () => {
  let provider;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('JamacioRocha.code-todo');
    provider = await ext.activate();   // activate() retorna o TodoTreeProvider
  });

  test('_parseContent encontra tags e coluna', () => {
    const items = provider._parseContent('a\n// TODO: fazer x\n// NOTE ok', '/tmp/f.js');
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].tag, 'TODO');
    assert.strictEqual(items[0].text, 'fazer x');
    assert.strictEqual(items[0].line, 1);
    assert.strictEqual(items[0].column, 3);
  });

  test('_shouldProcessFile ignora minificados e lockfiles', () => {
    assert.ok(!provider._shouldProcessFile('/x/app.min.js'));
    assert.ok(!provider._shouldProcessFile('/x/package-lock.json'));
    assert.ok(provider._shouldProcessFile('/x/app.js'));
  });
});
```

`activate()` em `src/extension.js` faz `return provider`, por isso `ext.activate()` dá acesso aos métodos internos (`_parseContent`, `_shouldProcessFile`, `_itemsChanged`, `_buildTreeFromStructure`, `fileMap`, `totalsByTag`...).

Para testes que dependem de arquivos/árvore, passe uma pasta de workspace ao `runTests` (`launchArgs: [pathDaFixture]` em `runTest.js`) — hoje nenhuma é passada, então `workspaceFolders` é `undefined` e `_buildTree()` retorna `[]`.

## Depois de mudar testes

Atualize `TESTS.md` e `TEST-README.md` (ambos descrevem os 4 testes e a saída esperada).
