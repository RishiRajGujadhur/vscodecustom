# Windows release — 27 October 2026

The new Windows x64 user installer bundles Structural Tools 0.2.0, including the project analysis commands, smart refactorings, workflow improvements and correctness fixes. Read the [full release notes](RELEASE_NOTES_2026-10-27.md) for features, installation, exact revisions and limits.

Local artifacts are in `.build/releases/2026-10-27/`: the dated `.exe`, `RELEASE_NOTES.md`, `SHA256SUMS.txt`, `BUILD_INFO.json` and clean release test results. This is an unsigned extension refresh of the existing Code OSS 1.144.0 application base, not a rebuild of the application core. The clean committed extension snapshot passed all 144 tests; unfinished local experiments are excluded.

The older preview notes below describe previous packages.

---

# Structural Tools Preview — Code OSS 1.144.0

Windows x64 user installation, with TypeScript Structure Tools 0.1.0 built in.

## Added

- **React component extraction:** move one selected JSX element or fragment into an adjacent component, infer captured props, generate a TypeScript interface or JavaScript JSDoc, update the source import and JSX, and preserve `use client`.
- **Rename previews:** review TypeScript symbol references, optional string/comment references, and optional workspace text matches in other supported file types.
- **React Structure and breadcrumbs:** navigate hooks, nested JSX, conditional branches, and `.map()` loops from Explorer and document-symbol ancestry.
- **Global refactorings:** extract or inline parameter objects with direct caller updates, plus supported member moves through explicit inheritance relationships.
- **Type and value analysis:** explore dependencies and dependents, possible static value flow, native type hierarchies, and project analysis hints in Problems.
- **Testing guide:** real application screenshots and a dependency-free editing fixture in the [walkthrough](README.md).

## Fixed

- Removed duplicate, unfiltered packaged dependencies that caused installer `MoveFile failed; code 3` failures under the default user installation path. Added path-length checks with temporary rename headroom.
- Kept React Structure available in Explorer when editor focus or language changes. The tree is empty for files without supported JSX structure.

## Validation and limits

The feature suite passed 22 tests. Installer path validation includes native Inno Setup fresh-copy and overwrite probes. The rebuilt installer compiled successfully, and the sample project type-checks. Screenshots were checked against the running packaged application.

This is an initial preview, not full JetBrains feature parity. Refactorings reject unsupported or ambiguous syntax and require approval of related edits in Refactor Preview. Text matches outside TypeScript are heuristic. Analysis is bounded and static; it does not prove runtime value flow or that a public API is unused. See [supported scope](../../extensions/structural-typescript/README.md#supported-boundaries).

The installer is unsigned. Its build and path probes do not establish that installation on every Windows configuration will succeed.

# Smart Refactoring 0.2.0

Adds 13 compiler-backed lightbulb intentions, a bounded intraprocedural CFG with reaching definitions/liveness/value facts, reference-aware Safe Delete, and a native Change Signature editor with supported caller migration. The tools share the existing compiler project and confirmation-preview infrastructure.

The release includes a standalone VSIX build command, the [new testing guide and screenshots](SMART_REFACTOR.md), 90 passing compiler/regression tests, and real extension-host checks against both source and bundled builds. Unsupported control constructs and ambiguous transformations are refused. Dynamic/external deletion risks are reported as uncertain; outside-project signature consumers are not rewritten. See the guide for exact supported subsets.

Install `structural-typescript-0.2.0.vsix` through **Install from VSIX** and reload to update an existing installation. The previously built Windows installer remains the 0.1.0 release.
