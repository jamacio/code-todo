# Change Log

All notable changes to the "Code TODO" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
