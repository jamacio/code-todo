---
name: code-todo-release
description: Passo a passo para lançar uma nova versão da extensão Code TODO (JamacioRocha.code-todo) — bump de versão no package.json, entrada no CHANGELOG.md, rebuild do bundle out/ commitado, commit, empacotamento .vsix com vsce e publicação no VS Code Marketplace. Use quando o usuário pedir para lançar, publicar, empacotar, gerar .vsix, subir versão, "bump", fazer release ou atualizar o changelog.
---

# Release do Code TODO

## 1. Decidir a versão (SemVer)

Versão atual fica em `package.json` → `"version"`. Patch para correções, minor para funcionalidade/performance, major para mudanças grandes. Confirme a versão com o usuário se não estiver óbvio.

## 2. Atualizar arquivos

1. `package.json` → `"version": "X.Y.Z"` (único lugar com a versão; `package-lock.json` também tem `version` — atualize com `npm install --package-lock-only` ou edite os dois campos do topo).
2. `CHANGELOG.md` → nova seção **no topo** (abaixo do cabeçalho), no estilo existente:

   ```markdown
   ## [X.Y.Z] - AAAA-MM-DD

   ### 🐛 Bug Fixes        (ou ### 🚀 ..., ### Added/Changed/Removed/Fixed)

   #### Fixed

   - **Título curto em negrito**: explicação técnica do que mudou e por quê
   ```

   Baseie o texto em `git log` / `git diff` desde a última tag de versão.
3. Se o formato do cache mudou, incremente `CACHE_VERSION` em `src/extension.js`.
4. Se o comportamento visível mudou, atualize `README.md` (ele já está desatualizado — ver skill `code-todo-architecture`).

## 3. Rebuild do bundle (obrigatório)

```bash
npm run compile        # webpack --mode production → out/extension.js + .map
```

`out/` é **versionado** e é o que o `.vsix` carrega (`main: ./out/extension.js`). Sempre inclua `out/extension.js` e `out/extension.js.map` no commit.

## 4. Testar

```bash
npm test               # roda pretest (compile) + testes no VS Code baixado
```

Ver skill `code-todo-testing` para ambiente headless.

## 5. Commit

Padrão de mensagem do repo (conventional commits curtos), ex.:

```
chore: bump version to 1.1.2 and <resumo da mudança>
```

Só commite quando o usuário pedir. Branch padrão: `main`.

## 6. Empacotar e publicar

```bash
npm run package                             # build + vsce package → code-todo-X.Y.Z.vsix
# ou, como no Makefile:
vsce package --allow-star-activation
vsce publish                                 # publica no Marketplace (publisher JamacioRocha)
```

- `vsce` já está instalado globalmente (`make install-vsce` se faltar).
- `.vscodeignore` exclui `src/`, `node_modules/`, `*.md`, `*.map` etc. do pacote — o `.vsix` leva basicamente `out/extension.js`, `package.json`, `resources/` e `LICENSE`.
- `*.vsix` está no `.gitignore`; não commite o pacote.
- **`vsce publish` e `git push` são ações externas e irreversíveis: confirme com o usuário antes de executar.** Publicar exige token (PAT) do publisher configurado no `vsce login`.

## Checklist rápido

- [ ] versão no `package.json` (e lock)
- [ ] seção no `CHANGELOG.md` com data de hoje
- [ ] `CACHE_VERSION` se necessário
- [ ] `npm run compile` e `out/` no commit
- [ ] `npm test` passou
- [ ] commit / tag / push / publish somente com aval do usuário
