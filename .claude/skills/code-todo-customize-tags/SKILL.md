---
name: code-todo-customize-tags
description: Receita para adicionar ou alterar tags (TODO, FIXME, NOTE...), ícones, extensões de arquivo suportadas, pastas excluídas, filtros de arquivo, cores do highlight ou settings configuráveis na extensão Code TODO. Use quando o usuário pedir "adicionar tag X", "suportar arquivos .xyz", "ignorar pasta", "mudar cor/estilo do destaque", "mudar ícone" ou "tornar algo configurável".
---

# Customizar tags, arquivos e aparência

Tudo está em [src/extension.js](../../../src/extension.js). Depois de qualquer mudança: `npm run compile` (o `out/` é commitado) e considere um item no `CHANGELOG.md`.

## Adicionar uma tag nova

1. Acrescente em `DEFAULT_TAGS` — **a posição define a ordem** na árvore e na status bar.
2. Adicione o ícone em `TAG_ICONS` (nome de [codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html), ex. `'flame'`). Sem entrada, usa `comment`.
3. Nada mais é necessário: `_buildRegex()` e `todoConfig.tagSet` derivam da lista.
4. Atualize `README.md` (seções Features e "Notes on Tags") e, se quiser, o teste de regex.
5. Não precisa mudar `CACHE_VERSION` (o formato do item não muda), mas o cache antigo não terá a tag nova até o arquivo mudar de mtime/size. Se quiser que todos re-escaneiem na hora, incremente `CACHE_VERSION`.

## Suportar nova extensão de arquivo

1. Adicione a extensão (sem ponto) em `SUPPORTED_EXT` — é um glob `{a,b,c}` usado por `findFiles` **e** pelo watcher.
2. Opcional: `activationEvents` em `package.json` tem um glob próprio `workspaceContains:**/*.{...}`; como também há `onStartupFinished`, não é obrigatório sincronizar.
3. Atualize a seção "Language Support" do `README.md`.

## Excluir pasta ou tipo de arquivo

- Pastas: adicione ao array `EXCLUDE_DIRS` (vale para o ripgrep e para o `EXCLUDE_GLOB` do fallback). Só afeta o scan completo; o watcher **não** usa essa lista, então arquivos editados nessas pastas ainda podem entrar.
- Arquivos específicos (minificados, lockfiles): adicione o glob em `EXCLUDE_FILES` (ripgrep) **e** a regra em `_shouldProcessFile` (watcher/edição/fallback). Mantenha o estilo de `if` encadeado com `===` / `endsWith` (escolha de performance).
- Lembre que o ripgrep também respeita o `.gitignore` do projeto.
- Tamanho máximo: `todoConfig.maxFileSize` (2 MB).

## Mudar o highlight

`this.decorationType` no construtor de `TodoTreeProvider` (`backgroundColor`, `color`, `border`, `borderRadius`, `overviewRulerColor`). O intervalo destacado é só a palavra da tag (`TodoItem.range`). Para destacar a linha inteira, use `isWholeLine: true` no decoration type ou altere `range`.

## Tornar algo configurável pelo usuário

O código já lê `vscode.workspace.getConfiguration('codeTODO').get('tags')` em `_loadConfig()` e reage a `onDidChangeConfiguration` (limpa cache e re-escaneia). Mas a setting **não está declarada** no `package.json`. Para expor corretamente:

```json
"contributes": {
  "configuration": {
    "title": "Code TODO",
    "properties": {
      "codeTODO.tags": {
        "type": "array",
        "items": { "type": "string" },
        "default": ["BUG","HACK","FIXME","TODO","XXX","NOTE","OPTIMIZE","REVIEW"],
        "description": "Tags to search for in comments."
      }
    }
  }
}
```

Ao adicionar novas settings, siga o mesmo padrão: ler em `_loadConfig()`, guardar em `todoConfig`, e se afetar o parsing, recriar a regex (`this.regex = this._buildRegex()`).

Cuidado: tags customizadas vão para `tagSet` em maiúsculo, mas a regex usa o texto como digitado e não tem flag `i` — normalize com `.toUpperCase()` em `todoConfig.tags` também, ou adicione `i` à regex.
