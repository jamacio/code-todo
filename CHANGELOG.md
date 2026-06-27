# Change Log

All notable changes to the "Code TODO" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.1.0] - 2026-06-27

### 🚀 Performance Rewrite

#### Changed

- **Incremental stats update**: Status bar now only processes the diff per file instead of iterating all items across all files on every keystroke
- **Removed JSON.stringify from change detection**: Replaced with lightweight field-by-field comparison, eliminating full array serialization on every edit
- **Eliminated double tree traversal**: Merged `_countTodosInStructure` into `_buildTreeFromStructure`, halving tree construction time
- **All `.forEach()` replaced with `for...of`/`for` loops**: 2-5x faster iteration in V8 with less GC pressure
- **Tag lookup O(n) → O(1)**: `Array.includes()` replaced with `Set.has()` for tag validation
- **Debounced tree refresh**: Coalesces rapid rebuilds during typing into a single call at 50ms
- **Debounced cache save**: Writes full cache once 2s after last change instead of on every keystroke/save
- **Pre-allocated arrays in tree building**: Avoids `.push()` overhead in hot paths
- **Faster file extension filtering**: Flat `if` chain instead of array iteration

#### Removed

- Dead code: unused `_onDidChangeStatus` emitter, `decorations` Map, `results` accumulator, `basePath` parameter, `type`/`files` fields from folder nodes

## [1.0.0] - 2025-09-20

### 🎉 Major Release

#### Added

- **Real-time document updates**: TODOs are now detected and updated instantly as you type
- **Hierarchical folder organization**: Tree view now organizes TODOs by folder structure for better navigation
- **Comprehensive tag support**: Supports TODO, FIXME, BUG, HACK, and XXX tags with distinct icons
- **Instant cache loading**: Previously scanned files load immediately without re-scanning
- **Complete test suite**: Added comprehensive testing infrastructure with 4 automated tests
- **English internationalization**: All comments and documentation translated to English

#### Improved

- **Massive performance optimization**: Significantly reduced memory usage for low-memory machines
- **Enhanced file processing**: Stream-based parsing with debouncing and batch processing
- **Improved highlight styling**: Better visual feedback with customizable background colors
- **Optimized caching system**: Intelligent cache management with version control
- **Background processing**: Non-blocking file scanning and tree updates

#### Technical

- **Node.js v20 compatibility**: Updated toolchain for modern packaging requirements
- **Webpack optimization**: Improved build process and bundle size
- **VSCode API modernization**: Updated to latest VS Code extension APIs
- **Testing infrastructure**: Complete Mocha test suite with CI-ready configuration

#### Fixed

- Resolved missing highlights after performance optimizations
- Fixed tree view not appearing on workspace load
- Corrected cache loading delays causing poor user experience
- Eliminated flat file structure causing navigation confusion

## [0.0.11]

### Improved

- Enhanced performance when loading the file.

## [0.0.10]

### Improved

- Implement weekly scan and optimize file processing

## [0.0.8]

### Improved

- Starting to read files when starting vscode

## [0.0.7]

### Improved

- Improved highlight functionality.
- Optimizing tag discovery

## [0.0.6]

### Added

- Separating cache by workspaces.

## [0.0.5]

### Added

- Initiating scan when opening VS Code.

## [0.0.4]

### Improved

- Improved regex for querying tags.

## [0.0.3]

### Improved

- Enhanced performance when loading the file.

## [0.0.1]

### Changed

- Initial release
