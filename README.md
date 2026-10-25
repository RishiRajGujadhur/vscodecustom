# Code OSS — Structural Tools

A custom Code OSS build with JetBrains-inspired tools for React and TypeScript. The built-in **TypeScript Structure Tools** extension adds extraction, rename previews, JSX navigation, refactorings across files, and dependency analysis.

[Testing walkthrough](docs/structural-tools/README.md) · [Release notes](docs/structural-tools/RELEASE_NOTES.md) · [Extension reference](extensions/structural-typescript/README.md)

## Smart Refactoring — 0.2.0

The shared TypeScript/JavaScript engine now also provides the four features in the [smart refactoring walkthrough](docs/structural-tools/SMART_REFACTOR.md):

| Feature | Try it |
| --- | --- |
| Advanced Intention Actions | Press `Ctrl+.` for 13 supported, validated transformations. |
| Function Data Flow | Run **Analyze Function Control and Value Flow** for a navigable CFG with reaching assignments, liveness, possible constants/null states, and unassigned reads. |
| Safe Delete | Run **Safe Delete Symbol** or **Safe Delete File** for blocking usages, removable imports, uncertainty reports, and guarded deletion previews. |
| Change Signature | Run **Change Signature and Update Callers** to edit parameters and migrate supported callers, overloads, constructors, and interface implementations. |

Use [smartRefactor.ts](docs/structural-tools/demo/smartRefactor.ts) to test these commands. Supported syntax is deliberately bounded; unsafe or ambiguous cases are refused. Build the standalone VSIX with `node scripts/package-structural-extension.mts`, then use **Install from VSIX**. The earlier Windows installer contains the 0.1.0 preview; install the 0.2.0 VSIX to test these additions.

![Function flow with reaching values and liveness](docs/structural-tools/screenshots/smart-flow.png)

![Signature migration and caller update preview](docs/structural-tools/screenshots/smart-signature-preview.png)

## Structural Tools Preview

This fork adds four JetBrains-inspired feature areas to Code OSS: React extraction and rename previews, JSX structure and breadcrumbs, refactorings that update callers across files, and type/value dependency analysis. These are an initial TypeScript/JavaScript implementation with conservative safety checks. CSS/HTML text matches are optional search results; this is not a shared AST for every language.

Open the [sample folder](docs/structural-tools/demo) in the custom build, then open the Command Palette (`Ctrl+Shift+P`) and search **TypeScript Structure**. No sample dependencies need installing. Follow the [illustrated testing walkthrough](docs/structural-tools/README.md) for exact selections, commands, expected results, and limitations.

### React Structure and breadcrumbs

Open `App.tsx`, expand **React Structure** in Explorer, and click the `<li>` entry. Hooks, conditional JSX, and `.map()` iterations appear in the tree and breadcrumb ancestry.

![React Structure tree and AST-aware breadcrumbs](docs/structural-tools/screenshots/react-structure.png)

### Extract React Component

Select the complete `<section>…</section>` in `App.tsx`, run **Extract React Component**, and enter `CounterPanel`. Review the new props interface, import, and replacement JSX. Select the edits you approve in **Refactor Preview** before applying them.

![Component extraction with captured props](docs/structural-tools/screenshots/extract-component.png)

### Refactor across files

Place the cursor in `formatBuild` in `formatBuild.ts` and run **Extract Parameter Object and Update Callers**. The preview includes an options interface and both calls in `dashboard.ts`.

![Parameter object preview updating separate caller files](docs/structural-tools/screenshots/parameter-object.png)

### Type dependency analysis

Click the `OwnedBuild` identifier in `models.ts`, run **Show Type Dependencies**, and expand the tree. It connects the intersection's `BuildJob` and `Owner` types, including `BuildJob`'s parent `Job`.

![Type dependencies through intersection and inheritance](docs/structural-tools/screenshots/type-dependencies.png)

The [walkthrough](docs/structural-tools/README.md) also covers rename modes, reverse parameter conversion, member movement, and possible value flow. Read the [release notes](docs/structural-tools/RELEASE_NOTES.md) for this installation. The [extension reference](extensions/structural-typescript/README.md) documents supported syntax, analysis limits, validation, and Windows installer builds.

## Build the Windows installer

On Windows x64, install the Node version specified in [.nvmrc](.nvmrc), Visual Studio's **Desktop development with C++** workload, and a Windows SDK. From the repository root, run:

```powershell
./scripts/build-structural-installer.ps1
```

The script validates the extension, packages Code OSS, and produces an unsigned user installer under `.build/win32-x64/user-setup/`, together with checksums. Building does not install the application. See the [release notes](docs/structural-tools/RELEASE_NOTES.md) for the installer path fix and supported scope.

## Development

The custom extension lives in [extensions/structural-typescript](extensions/structural-typescript). After installing its dependencies, run its focused test suite with:

```powershell
npm --prefix extensions/structural-typescript test
```

For the base editor's architecture, contribution guidelines, and development workflow, see [CONTRIBUTING.md](CONTRIBUTING.md), [the upstream repository](https://github.com/microsoft/vscode), and the [development container guide](.devcontainer/README.md).

## License and attribution

This project is a fork of Microsoft's Visual Studio Code open-source repository. Code OSS is licensed under the [MIT License](LICENSE.txt). Microsoft copyright notices and applicable third-party notices remain in their source files and [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

## Move Module Members

Open a TypeScript/JavaScript project and place the cursor inside a top-level exported declaration, or select several exports. Run **TypeScript Structure: Move Module Members**, choose an existing source file, then choose **Review Edits**. Inspect the destination, dependency imports and updated consumers in Refactor Preview before applying. Try `moduleSource.ts` → `moduleTarget.ts` in the [demo](docs/structural-tools/demo); `moduleConsumer.ts` uses an aliased import that follows the move.

Moves use TypeScript’s import-aware refactoring and reject edits that introduce compiler errors. Source and destination must share module directives. Review initialization order, circular dependencies and consumers outside the active compiler project; those runtime and external uses cannot be proven safe. Existing files only; no automatic file creation.

![Move exports and update imports in Refactor Preview](docs/structural-tools/screenshots/move-module-members.png)

## Find Dead Code

Open an application entry file and run **TypeScript Structure: Find Dead Code**. Select **all** application, test and framework entry files in the multi-select picker; the active file is preselected on the first run, and later runs remember the entry selection for this compiler project. Their exports count as public API. Results appear in **Problems** as possibly unused exports, JSX components, functions/classes, and files unreachable from those entries. Click a result to navigate. Try `deadCodeEntry.ts`, which uses `activeLabel` but leaves `unusedLabel`, its recursive helper and the orphan module unused.

The analysis follows resolved symbols, imported aliases, barrel exports, JSX references and module dependencies. Dead recursive groups do not keep each other alive. Executable initializer uses are retained conservatively. It scans the active compiler project, excludes declarations and dependencies, and includes unsaved buffers. Named declarations are analyzed; anonymous default declarations are not separately reported. Dynamic imports with computed paths, reflection, plugin registration, framework discovery and external package consumers require manual review. No code is deleted. Results clear when files change; rerun the command for a fresh report.

![Dead code candidates in the Problems panel](docs/structural-tools/screenshots/find-dead-code.png)

## Advanced Nullability Analysis

Open a TypeScript/JavaScript file and run **TypeScript Structure: Advanced Nullability Analysis**. Expand a warning in **Problems** to inspect **Possible Value Source**, **Possible Return Value** and **Path Condition** links. Click a link to navigate to the origin or condition. In [nullabilityPaths.ts](docs/structural-tools/demo/nullabilityPaths.ts), `label.length` is unsafe after `lookupLabel` can return `undefined`; the access inside `if (label !== undefined)` and the optional chain are guarded.

The analysis uses TypeScript control-flow narrowing through branches, assignments, aliases and function return types. An isolated compiler project enables strict null checks, JavaScript checking and unchecked-index checks without changing your configuration. It includes unsaved buffers and reports unsafe accesses, nullable calls and null-related assignment/argument errors across the active project. Existing TypeScript diagnostics may appear alongside the warnings with source traces. Results clear when source files change.

Traces show potential origins, with up to five recursive hops and twenty locations per warning. Earlier assignments and function returns are candidates; the trace does not prove that each reaches the failing use. `any`, explicit non-null assertions, inaccurate declarations, external code and runtime mutation can hide hazards. Call-site-specific parameter tracing and exhaustive symbolic execution are outside this analysis.

![Nullability warning with navigable return values and branch condition](docs/structural-tools/screenshots/advanced-nullability.png)

## Test Impact Analysis

Run **TypeScript Structure: Test Impact Analysis** from the Command Palette or editor context menu, then choose a scope:

| Scope | What it analyzes |
| --- | --- |
| Function or Symbol at Cursor | Follows resolved references through callers, helpers, aliases and re-exports to individual test registrations. Place the cursor on a declaration name or a referenced symbol. |
| Active Module | Follows reverse imports transitively and lists tests in dependent test modules, including side-effect imports, literal dynamic imports and CommonJS `require`. This broader scope includes all recognized cases in an affected file. |
| Git-Changed Modules | Uses the built-in Git extension’s staged, working-tree, untracked and merge changes, plus unsaved buffers in the active repository. Analyzes those modules against the active compiler project. Changes already committed to a branch are outside this scope. |

The searchable picker shows each potentially affected test, its file and an illustrative dependency chain. Select a result to open the test registration. Results are deduplicated, cycles terminate, and navigation checks the project snapshot to reject stale results. No tests run automatically.

Try [impactSource.ts](docs/structural-tools/demo/impactSource.ts): place the cursor on `formatImpactLabel` and choose **Function or Symbol at Cursor**. The two label tests in `impactSource.test.ts` appear, including the path through `displayImpactLabel`; the unrelated totals test is excluded. **Active Module** includes all three tests.

Test discovery recognizes `.test.*`, `.spec.*`, `test/`, `tests/`, and `__tests__/` paths, and files importing Node’s test API, Vitest, Jest globals, Playwright Test or Mocha. Literal `test`/`it` titles, imported aliases, suite titles, common modifiers and `.each(...)` registrations are supported. Module analysis falls back to a test file entry when no static cases are found. Parameterized registrations are listed once. Shared hooks and test-file initialization conservatively include every recognized case in that file.

Keep source and tests in the same compiler project; excluded test projects are not scanned. If the application config excludes tests, open a test file under a config that includes them and select the imported symbol there. Git mode reports changed files outside that project or deleted from it as unanalyzed. Computed module paths, reflection, custom registration wrappers, mocks, runtime global effects and anonymous declarations can require broader module analysis or additional tests. The report is a static candidate list and does not establish runtime coverage.

![Affected test cases with direct and transitive symbol reference chains](docs/structural-tools/screenshots/test-impact-analysis.png)

## Everyday Structural Tools

Run **TypeScript Structure: Open Structural Tools** for a searchable picker covering the analysis, refactoring and intention commands. The [quality-of-life guide](docs/structural-tools/QUALITY_OF_LIFE.md) shows remembered entry files and move destinations, clearable analysis results, test-impact clipboard exports, signature undo/reset with inline validation, grouped deletion reports, and flow-view filters with screenshots.
