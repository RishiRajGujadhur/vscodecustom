# Structural Tools 0.2.0 — Windows release, 27 October 2026

Windows x64 user installer: `CodeOSS-Structural-UserSetup-x64-1.144.0-0.2.0-20261027.exe`.

This release updates the built-in TypeScript Structure Tools from 0.1.0 to 0.2.0. It reuses the previously packaged Code OSS 1.144.0 application base (`a8cabf9dfefdf7bad530c17890ae6194cf97b73a`), with the structural extension rebuilt from committed revision `4e429a6307fa43abd8d3c9c095f8d41d58669ca3`. It is an extension refresh of that application base. Uncommitted worker/toolkit experiments are excluded.

## Added

- **Move Module Members:** move top-level exported declarations between existing files in the compiler project, updating supported imports and consumers. Matching module directives are required. Review initialization order and the proposed edits before applying them.
- **Find Dead Code:** choose entry files and inspect possibly unused exports, components, functions/classes and unreachable files in Problems. Entry choices are remembered per compiler project.
- **Advanced Nullability Analysis:** inspect TypeScript's flow-sensitive null/undefined warnings, with related locations for potential sources, branch conditions and return values.
- **Test Impact Analysis:** find statically linked test cases from a symbol, an active module or Git-changed modules. Results show dependency chains and navigate to tests.
- **Change Signature:** edit supported function, method and constructor parameters, then preview caller migrations within the compiler project.
- **Safe Delete:** review blocking references, removable imports and initialization risks before previewing supported symbol or file deletion.
- **Function Data Flow:** inspect supported functions' control flow, reaching assignments, possible unassigned reads, liveness and property mutations. Use **Go to Reaching Value Origins** for assignment navigation.
- **Advanced Intention Actions:** access 13 compiler-backed rewrite intentions through the lightbulb, Ctrl+., or the structural tool picker. Unsupported or unsafe transformations are refused.

## Everyday workflow improvements

- Run **TypeScript Structure: Open Structural Tools** for a searchable command picker with descriptions.
- Reuse remembered dead-code entry files, module-move destinations and test-impact scope.
- Search impacted tests by test title, file path or dependency chain. Every search word must match. Copy matching paths or reports; clear the search to copy all results.
- Use undo, redo and reset in the signature editor. If preview validation rejects a draft, choose **Continue Editing** to keep the draft and its history.
- Run **Copy Last Analysis Report** to copy dead-code/nullability findings with source locations and related traces.
- Run **Clear Analysis Results** to clear structural diagnostics, cached reports and dependency trees.
- Filter flow nodes and toggle unreachable nodes. Safe Delete groups blocking references first and displays source lines and counts.

## Correctness fixes

- Refuse removing effectful default parameters and preserve parameter types in `.mts`/`.cts` signature edits.
- Preserve distinct overload types when displaying or renaming parameters.
- Treat class initialization effects and known local declaration-file consumers conservatively during deletion review.
- Correct flow handling of relational operators, bracket writes, increments and property deletion; reject unsupported destructuring writes.
- Refuse unsafe guard-clause rewrites and extraction of repeated ambient reads that may invoke getters.
- Map normalized line endings safely and reject changed source before applying edits.
- Revalidate test-impact exports and cached analysis reports before copying; stale results leave the clipboard unchanged.
- Preserve the original move selection and reject edits made while choosing a destination.
- Prevent superseded analysis runs from clearing newer diagnostics, and reject reaching-value navigation after source edits.

## Install and use

1. Close Code OSS and run the new `.exe`. It is a Windows x64 **user installer** and does not require a separate VSIX for these tools.
2. Open a trusted TypeScript or JavaScript project, then a source file.
3. Run **TypeScript Structure: Open Structural Tools** from the command palette. Use the [testing walkthrough](https://github.com/RishiRajGujadhur/vscodecustom/blob/4e429a6307fa43abd8d3c9c095f8d41d58669ca3/docs/structural-tools/README.md) and [workflow guide](https://github.com/RishiRajGujadhur/vscodecustom/blob/4e429a6307fa43abd8d3c9c095f8d41d58669ca3/docs/structural-tools/QUALITY_OF_LIFE.md) for examples and manual regression checks.

If an older standalone TypeScript Structure Tools VSIX overrides the bundled tools, uninstall that separate extension and reload to use the built-in copy. The installer and checksum file are supplied together; verify with PowerShell `Get-FileHash -Algorithm SHA256 -LiteralPath <installer-path>`.

## Scope and validation

Analysis is static and bounded. Dynamic loading, framework conventions, external tests and consumers outside the active compiler project can require manual review. Dead-code findings are candidates, not proof of safe deletion. Refactorings retain validation and Refactor Preview confirmation.

The clean committed extension snapshot passed all 144 tests, including compiler/refactoring regressions and the stale-result workflow checks, with zero failures. The release build also compiles the extension and tests and checks packaged file paths against the Windows installer rename limit. The previous 158-test working-tree run included 14 experimental tests from uncommitted work; those experiments are excluded here.

The installer is unsigned. This package refresh does not rebuild the Code OSS application core. Installation on this machine is not performed as part of packaging. See the accompanying build information for the exact base and extension revisions and the release validation results.
