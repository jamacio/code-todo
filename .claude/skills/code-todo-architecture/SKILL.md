---
name: code-todo-architecture
description: Mapa da arquitetura da extensão VS Code "Code TODO" (JamacioRocha.code-todo) — como o TodoTreeProvider em src/extension.js escaneia arquivos, faz cache no globalState, monta a árvore agrupada por tag, destaca linhas e atualiza a status bar, além das armadilhas conhecidas. Use antes de alterar, depurar ou explicar qualquer comportamento da extensão (scan, regex de tags, cache, árvore lateral, highlight, status bar, watchers, performance).
---

# Arquitetura do Code TODO

Extensão VS Code em **JavaScript puro (CommonJS)**. Todo o código de runtime está em um único arquivo:
[src/extension.js](../../../src/extension.js) (~700 linhas). Não há TypeScript de verdade, apesar de existir `tsconfig.json` e `ts-loader` no webpack.

## Arquivos que importam

| Arquivo | Papel |
|---|---|
| `src/extension.js` | Tudo: constantes, `TodoItem`, `TodoTreeProvider`, `activate`/`deactivate` |
| `package.json` | Manifesto: comando `codeTODO.refresh`, view container `todoExplorer`, view `todoTreeView`, `main: ./out/extension.js` |
| `webpack.config.js` | Bundle `src/extension.js` → `out/extension.js` (target node, `vscode` externo) |
| `out/extension.js(.map)` | **Bundle commitado no git.** Precisa ser regenerado (`npm run compile`) e commitado junto com mudanças em `src/` |
| `src/test/**` | Testes de integração (ver skill `code-todo-testing`) |
| `resources/todo.svg`, `resources/icon.png` | Ícone da activity bar e do marketplace |

## Constantes no topo de `src/extension.js`

- `CACHE_VERSION` (hoje 45) — a chave do cache é `todoCache_v${CACHE_VERSION}` no `context.globalState`. **Incremente sempre que mudar o formato de `TodoItem` ou da entrada de cache**, senão usuários carregam dados velhos incompatíveis.
- `SUPPORTED_EXT` — glob de extensões escaneadas (usado em `findFiles`, no `FileSystemWatcher` e no `-g` do ripgrep).
- `EXCLUDE_DIRS` — pastas ignoradas (node_modules, vendor, dist, out, build, .git, venv, .next...); `EXCLUDE_GLOB` é derivado dela.
- `EXCLUDE_FILES` — globs de arquivos ignorados pelo ripgrep (`*.min.js`, `*.map`, lockfiles); espelha `_shouldProcessFile`.
- `DEFAULT_TAGS` — `BUG, HACK, FIXME, TODO, XXX, NOTE, OPTIMIZE, REVIEW`. A **ordem** define a ordem dos nós na árvore e na status bar.
- `TAG_ICONS` — tag → nome de codicon (`ThemeIcon`). Tag sem ícone cai em `comment`.
- `todoConfig` — estado global mutável: `tags`, `tagSet` (Set p/ lookup O(1)), `maxFileSize` (2 MB; arquivos maiores são pulados).

## Fluxo de dados

```
activate()
 └─ new TodoTreeProvider(context)
     └─ _initialize()
         1. _loadConfig()          lê setting `codeTODO.tags` (opcional)
         2. _loadCacheAsync()      globalState → this.cache / this.fileMap (sem fs.access; o scan reconcilia)
         3. highlights + refresh imediato a partir do cache
         4. _setupWatchers()
         5. startScan()
             ├─ _getRipgrepPath() encontrou o rg do VS Code → _scanWithRipgrep()   (caminho principal)
             └─ senão (fallback)  findFiles → compara mtime/size → _processFilesInBatches (lotes de 50)
                                   e remove do fileMap arquivos que não existem mais
```

### Scan com ripgrep (técnica do todo-tree)

- `_getRipgrepPath()` procura o binário embutido no VS Code a partir de `vscode.env.appRoot`. Ordem: `@vscode/ripgrep-universal/bin/<platform>-<arch>/rg` (VS Code ≥ ~1.140), `@vscode/ripgrep/bin/rg`, `vscode-ripgrep/bin/rg`, cada um em `node_modules.asar.unpacked` e `node_modules`. Resultado memorizado em `this._rgPath` (`null` = usar fallback).
- `_runRipgrep()` faz `spawn` (sem shell) com `--null --line-number --hidden --max-columns 1000 --max-filesize`, `-g` para `SUPPORTED_EXT`, `EXCLUDE_DIRS` e `EXCLUDE_FILES`, e padrão grosso `\b(TAG|...)\b`. A saída `<path>\0<linha>:<texto>` é lida em streaming e a **mesma `this.regex` JS** extrai tag/texto/coluna — os resultados são idênticos aos do parser JS.
- O rg respeita `.gitignore` (o fallback não).
- Depois do scan, documentos **não salvos** (`isDirty`) são re-parseados em memória e sobrescrevem o resultado do disco; então `fileMap`/`cache` são substituídos por inteiro (entradas de cache do rg não têm `mtime`/`size`).
- Só falha de `spawn` cai no fallback; exit code 1 (sem matches) e 2 (erros parciais) são aceitos.
- Ganho medido: projeto com ~7 mil arquivos, 2,7 s → 55 ms.

Estruturas principais:
- `this.cache: Map<filePath, {mtime, size, items}>` — persistido.
- `this.fileMap: Map<filePath, TodoItem[]>` — fonte da verdade da árvore; só contém arquivos com ≥1 item.
- `this.totalsByTag` / `this.totalTodos` — contadores atualizados **incrementalmente** por `_updateStatsIncremental(old, new)`; `_updateStats()` recalcula tudo (só no load/scan).

Dois caminhos de parsing com a mesma regex:
- `_parseFile` — stream + `readline` (disco).
- `_parseContent` — `document.getText()` em memória (digitação e highlight).

Regex (`_buildRegex`): `\b(TAG1|TAG2|...)(?=\s|:)[:]?\s*(.*)` com flag `g`. Sempre zere `this.regex.lastIndex = 0` antes de cada linha. Não exige que esteja dentro de comentário — qualquer `TODO ` no texto conta.

## Eventos e debounces

| Evento | Handler | Debounce |
|---|---|---|
| Watcher change/create | `_handleFileChange` → `_processFile` | 300 ms por arquivo |
| Watcher delete | `_handleFileDelete` | — |
| Digitação (`onDidChangeTextDocument`) | `_handleDocumentChange` → `_processDocumentInMemory` | 150 ms por arquivo |
| Save | `_handleDocumentSave` → `_processFile` | — |
| Troca de editor | `_applyHighlights` | — |
| Config `codeTODO.*` | limpa tudo e `startScan()` | — |
| Refresh da árvore | `_debouncedRefresh` → `_onDidChangeTreeData.fire()` | 50 ms global |
| Gravar cache | `_debouncedSaveCache` → `_saveCache` | 2 s global |

`_shouldProcessFile` filtra binários, `.min.js/.min.css`, `.map` e lockfiles.

## Árvore lateral

Hierarquia: **Tag (contagem)** → pastas → **arquivo (contagem)** → item (`label` = texto, `description` = `[TAG]  Ln N`, clique abre `vscode.open` na linha).

- `getChildren(undefined)` → `_buildTree()`: se `treeNeedsRebuild` for falso devolve `cachedTree`; senão reconstrói `this._tagStructures` (Map tag → Map aninhado de pastas, com chave especial `'__files__'`) e devolve só os nós de tag com `children: null`.
- `getChildren(tagNode)` → constrói os filhos **sob demanda** via `_buildTreeFromStructure` (recursivo, retorna `{nodes, count}`; pastas antes de arquivos, ordenado por label).
- Nós são objetos literais (não `vscode.TreeItem`); `getTreeItem` retorna o próprio elemento. `contextValue`: `tag`, `folder`, `file`, `todo`.
- Só considera `workspaceFolders[0]` — arquivos fora da primeira pasta do workspace são ignorados na árvore.

## Status bar e highlight

- Status bar à esquerda: `$(checklist) TODO:3 | FIXME:1`, clique executa `codeTODO.refresh`.
- Highlight: um único `decorationType` (fundo branco translúcido, marca amarela na régua) aplicado ao intervalo da **palavra da tag**, re-parseando o documento ativo.

## Comando

`codeTODO.refresh` (registrado em `activate`): limpa `fileMap` e `cache`, marca rebuild e roda `startScan()` completo.

## Armadilhas conhecidas (verifique antes de "corrigir")

1. `_tagStructures` precisa existir desde o construtor — bug corrigido na 1.1.1 (VS Code pode chamar `getChildren(tag)` antes de `getChildren(undefined)`).
2. A setting `codeTODO.tags` é lida no código mas **não está declarada** em `contributes.configuration` do `package.json`.
3. A regex não tem flag `i`; tags customizadas em minúsculo entram em `tagSet` em maiúsculo mas a regex procura o texto literal.
4. `README.md` está desatualizado: lista só 5 tags e poucas extensões e diz "MIT", mas `LICENSE` é uma licença **não comercial** própria.
5. Os testes reimplementam a regex e o filtro de extensões em vez de testar o código real — mudar `src/extension.js` não quebra esses testes.
6. `.gitignore` ignora `package-lock.json`, mas ele está versionado.
7. Mudanças em `src/` sem rebuild de `out/` fazem a extensão empacotada rodar código antigo.

## Convenções de código

- Hot paths usam `for` / `for...of` em vez de `.forEach`, arrays pré-alocados (`new Array(n)`), `Set.has` em vez de `includes`, `if` encadeado em vez de iterar arrays. Mantenha esse estilo (foi o foco da reescrita 1.1.0).
- Métodos privados com prefixo `_`; indentação de 2 espaços; aspas simples (algumas duplas em `activate`).
- Erros são engolidos com `console.error` — a extensão nunca deve lançar para o host.
