# TypeScript Structure Tools

This desktop extension adds React extraction/structure, global refactorings and type dependencies, plus advanced intentions, function data flow, Safe Delete and Change Signature. It uses a command-scoped TypeScript compiler project shared by the refactoring and analysis commands. Unsaved buffers participate in analysis. Commands operate in the active file's nearest `tsconfig.json` or `jsconfig.json`, rather than treating unrelated projects as one program.

## Commands and views

See the [illustrated walkthrough and sample project](../../docs/structural-tools/README.md) for reproducible tests in the custom build.

Open the Command Palette and search for **TypeScript Structure**. The commands also appear in the editor's **TypeScript Structure** context submenu.

| Feature | Usage |
| --- | --- |
| Extract React Component | Select exactly one JSX element or fragment. Enter an uppercase component name. Review creation of the adjacent `.tsx`/`.jsx` file, captured props, imports and replacement JSX. TypeScript uses a generated props interface; JavaScript uses JSDoc rather than adding a PropTypes dependency. `use client` is preserved. |
| Rename with Text Reference Preview | Place the cursor on a symbol. Choose semantic references, project strings/comments, or additional workspace text matches. The last option includes CSS, HTML, JSON, Markdown, Vue/Svelte and build-script text outside the compiler program. Text matches are heuristics and require review. |
| React Structure | The Explorer view displays declarations, nested JSX, hooks, conditional expressions and `.map()` iterations. Click an entry to navigate. The React document-symbol provider also contributes an Outline source and breadcrumb ancestry. |
| Extract Parameter Object and Update Callers | Place the cursor inside a named function with two or more required parameters. The edit creates an options interface, destructures parameters and rewrites statically resolved direct callers, including imported aliases. |
| Inline Parameter Object and Update Callers | Converts a single destructured object parameter back to positional parameters. Callers must use object literals in parameter order so expression evaluation order remains intact. Removes a local options interface only when it has no other references. |
| Pull Member Up / Push Member Down | Place the cursor on a class/interface member. Pull moves to a single explicit parent; push copies to every direct child before removing the source. Required imported dependencies are copied and relative module paths are rebased. |
| Show Type Hierarchy | Use the native editor command on a class/interface to explore extends/implements relationships. |
| Show Type Dependencies / Dependents | Shows inheritance plus referenced types, including union and intersection branches, in the **Type and Value Dependencies** Explorer view. |
| Show Possible Value Flow from/to Here | Shows explicit assignments, property initialization, resolved call arguments and named-function returns. The tree describes possible static dependencies, not runtime execution. |
| Analyze Project Types and Unused Declarations | Publishes compiler unused-declaration diagnostics, possible unread internal interface fields, and statically constant primitive `typeof` comparisons to Problems. Public fields and recognized dynamic accesses are excluded from unread-field hints. |

All refactorings open Code OSS's editable refactoring preview, with per-edit confirmation metadata. Canceling the preview leaves files untouched; an accepted workspace edit participates in editor undo. New component files cannot overwrite existing files. Compiler validation rejects edits introducing new TypeScript errors. Source snapshots are checked before edits are prepared for the editor.

## Supported boundaries

This is an initial implementation, not full JetBrains parity. TypeScript/JavaScript use one compiler program; CSS, HTML and other workspace text do not share that AST. Renaming those files is explicitly opt-in textual matching. Project references are not automatically merged, and computed dynamic imports/CommonJS bridges are limited by TypeScript's module resolution and project settings.

Extraction conservatively refuses mutations, context-dependent expressions, hook calls inside the selection, reserved captured `key`/`ref` names, and root keys/spreads that could change React reconciliation. Unavailable local types or other generated compiler errors also stop extraction. It copies source imports; unused imports can subsequently be removed with Organize Imports. It does not relocate CSS rules or assets.

Parameter conversion rejects overloads, generics, default/optional/rest parameters, `arguments`, indirect function references, ambiguous callers and overlapping nested transformations. Member movement rejects generic containers, private/override/super-dependent members, decorators and initialized class fields. Dependencies that cannot be imported or moved safely are reported by compiler validation. Preview remains necessary: type checking cannot prove runtime equivalence.

Analysis trees are bounded to eight levels and 500 nodes, with cycles/limits marked `…`, and are snapshots cleared when source buffers change. Run the command again to refresh them. Static value flow does not model heap aliasing, scheduling, arbitrary callbacks, reflection, or arbitrary runtime values. Unread-field and redundant-guard hints are evidence for review, not proofs that code can be deleted. Workspace text search is limited to 5,000 files and 2 MiB per file; exceeding either limit stops rather than silently producing partial changes.

## Validation

After installing this extension's dependencies:

```powershell
npm --prefix extensions/structural-typescript test
```

The source checkout uses `out/extension.js`; the repository packaging pipeline bundles to `dist/extension.js`, copies TypeScript's standard library declarations, and rewrites the manifest entry point. The extension is included in the normal built-in extension installation and compilation lists.

## Windows installer

From the repository root, on Windows x64 with the Node version in `.nvmrc`, Visual Studio's **Desktop development with C++** workload, and a Windows SDK installed:

```powershell
./scripts/build-structural-installer.ps1
```

The script installs locked dependencies, runs the extension compiler and tests, packages Code OSS, checks that the bundled extension and compiler standard library are present, and builds the unsigned user installer. Outputs are `.build/win32-x64/user-setup/*.exe` and `SHA256SUMS.txt`. It does not install the resulting application.

The **Structural Tools Windows Installer** GitHub workflow performs the same build on `windows-2022` and uploads the installer and checksum artifacts. A successful workflow run is required to confirm an installer was produced; merely committing the workflow does not create one.

## Advanced intentions

Use the lightbulb or `Ctrl+.` on supported source shapes. The shared registry provides return-branch/ternary conversion, literal-array accumulation to `map`, a native Promise fulfillment-to-await conversion, local anonymous function-to-arrow conversion, repeated pure-expression extraction, Boolean comparison simplification, nullable receiver guards, return guard clauses, string templates, unchanged `let` to `const`, local object shorthand methods, and optional nullable returns. All actions use applicability checks, source snapshots, compiler validation, and the existing confirmation preview.

These are deliberately bounded transformations. Loops require an adjacent fresh local array, literal numeric inputs, and a pure projection. Functions with lexical context or escaped references are refused. Comments inside rewritten nodes suppress intentions. Nullable guards intentionally skip the call when the receiver is absent. Unsupported shapes are omitted from the lightbulb rather than guessed.

## Function control and value flow

**Analyze Function Control and Value Flow** opens an interactive function CFG beside the editor. Select a local variable before invoking it to see reaching assignment IDs and possible literal values at each node. The graph shows liveness, possible reads before assignment, branch and exceptional exits, unreachable statements, and known property mutation sites. Click a node or an edge destination to navigate. **Go to Reaching Value Origins** lists assignments that may reach the selected variable use. Editing the analyzed document closes its snapshot.

The first CFG supports block-bodied functions, simple `let`/`const` bindings, assignments, if/else, while/do/for loops, break/continue, return and throw. Reaching definitions and liveness use fixed points; constant sets widen to unknown after eight values. Loose null checks refine nullable branch values. Exceptions are conservative exits carrying pre-assignment facts. Calls do not receive interprocedural summaries. Nested functions, destructuring, var declarations, parameter initializers, try/catch/finally, switch, for-in/of, labels and embedded/conditional writes are explicitly refused. A graph is static evidence, not a runtime execution trace or a full model of heap aliases.

## Safe Delete

**Safe Delete Symbol** resolves a declaration and opens a usage/risk report before offering deletion edits. Known callers, inheritance/type usages, and other executable references block the operation. Unused imports can be cleaned up; module evaluation follows `verbatimModuleSyntax`, and type-only imports do not become runtime imports. Overload declarations are treated together. Import aliases are deleted as bindings, never by deleting the imported implementation. **Safe Delete File** checks static imports, re-exports, dynamic literal imports, require paths and triple-slash references.

Dynamic/reflection matches, public members, exports and possible external consumers are explicitly uncertain. With no known blockers, the user may deliberately review an uncertain deletion; the extension never labels it proven safe. Initialization effects and unsupported declarations are blocked. No dependent business logic is automatically removed. The source graph is checked again after the report, and source snapshots protect edit/file previews. Approve related import and deletion edits together. Workspace consumers outside the active compiler project and computed runtime module paths cannot be fully ruled out.

## Change Signature

**Change Signature and Update Callers** provides a native parameter editor with add, remove, rename, move, type, optional/default and migration-expression controls. New required parameters need an explicit caller expression; no placeholder business value is invented. It updates resolved direct calls, compatible overload families, explicit constructors, and related interface/class methods. Parameter renames preserve shorthand keys. The editor also exposes the existing options-object conversion. Escape cancels before edits; Preview checks the source graph again and validates the compiler result.

Compatible overloads must have the same parameter count and names; distinct original types are retained unless explicitly overridden. Rest/destructured parameters, constructor parameter properties, generators/arguments, indirect callbacks, optional calls, spreads, reflective/dynamic calls, and inconsistent signature families are refused. Removing a referenced parameter is refused. Argument reordering/removal is rejected when it could reorder or erase effects; reordering default parameters is also refused. JavaScript requires `checkJs`. External consumers outside this compiler project are not rewritten. Formatting outside changed spans is retained; comments inside a rewritten parameter list suppress the operation.

## Standalone VSIX and integration validation

From this repository with its extension and build dependencies installed:

```powershell
node scripts/package-structural-extension.mts
node extensions/structural-typescript/test/run-integration.mts "path/to/Code - OSS.exe"
```

The first command bundles the compiler, standard library declarations and license notices into `.build/releases/structural-typescript-0.2.0.vsix`. Install through **Extensions → Install from VSIX** and reload the editor. This updates the extension without rebuilding the earlier Windows installer. The integration runner uses isolated temporary profile, extension and shared-data directories. It checks actual extension-host registration, lightbulb actions, the flow webview, blocked deletion and cancelled signature editing. Successful runs remove their temporary profile; failed runs retain it for diagnostics.

## Move Module Members

Open a TypeScript/JavaScript project and place the cursor inside a top-level exported declaration, or select several exports. Run **TypeScript Structure: Move Module Members**, choose an existing source file, then choose **Review Edits**. Inspect the destination, dependency imports and updated consumers in Refactor Preview before applying. Try `moduleSource.ts` → `moduleTarget.ts` in the [demo](../../docs/structural-tools/demo); `moduleConsumer.ts` uses an aliased import that follows the move.

Moves use TypeScript’s import-aware refactoring and reject edits that introduce compiler errors. Source and destination must share module directives. Review initialization order, circular dependencies and consumers outside the active compiler project; those runtime and external uses cannot be proven safe. Existing files only; no automatic file creation.

![Move exports and update imports in Refactor Preview](../../docs/structural-tools/screenshots/move-module-members.png)

## Find Dead Code

Open an application entry file and run **TypeScript Structure: Find Dead Code**. Select **all** application, test and framework entry files in the multi-select picker; the active file is preselected on the first run, and later runs remember the entry selection for this compiler project. Their exports count as public API. Results appear in **Problems** as possibly unused exports, JSX components, functions/classes, and files unreachable from those entries. Click a result to navigate. Try `deadCodeEntry.ts`, which uses `activeLabel` but leaves `unusedLabel`, its recursive helper and the orphan module unused.

The analysis follows resolved symbols, imported aliases, barrel exports, JSX references and module dependencies. Dead recursive groups do not keep each other alive. Executable initializer uses are retained conservatively. It scans the active compiler project, excludes declarations and dependencies, and includes unsaved buffers. Named declarations are analyzed; anonymous default declarations are not separately reported. Dynamic imports with computed paths, reflection, plugin registration, framework discovery and external package consumers require manual review. No code is deleted. Results clear when files change; rerun the command for a fresh report.

![Dead code candidates in the Problems panel](../../docs/structural-tools/screenshots/find-dead-code.png)

## Advanced Nullability Analysis

Open a TypeScript/JavaScript file and run **TypeScript Structure: Advanced Nullability Analysis**. Expand a warning in **Problems** to inspect **Possible Value Source**, **Possible Return Value** and **Path Condition** links. Click a link to navigate to the origin or condition. In [nullabilityPaths.ts](../../docs/structural-tools/demo/nullabilityPaths.ts), `label.length` is unsafe after `lookupLabel` can return `undefined`; the access inside `if (label !== undefined)` and the optional chain are guarded.

The analysis uses TypeScript control-flow narrowing through branches, assignments, aliases and function return types. An isolated compiler project enables strict null checks, JavaScript checking and unchecked-index checks without changing your configuration. It includes unsaved buffers and reports unsafe accesses, nullable calls and null-related assignment/argument errors across the active project. Existing TypeScript diagnostics may appear alongside the warnings with source traces. Results clear when source files change.

Traces show potential origins, with up to five recursive hops and twenty locations per warning. Earlier assignments and function returns are candidates; the trace does not prove that each reaches the failing use. `any`, explicit non-null assertions, inaccurate declarations, external code and runtime mutation can hide hazards. Call-site-specific parameter tracing and exhaustive symbolic execution are outside this analysis.

![Nullability warning with navigable return values and branch condition](../../docs/structural-tools/screenshots/advanced-nullability.png)

## Test Impact Analysis

Run **TypeScript Structure: Test Impact Analysis** from the Command Palette or editor context menu, then choose a scope:

| Scope | What it analyzes |
| --- | --- |
| Function or Symbol at Cursor | Follows resolved references through callers, helpers, aliases and re-exports to individual test registrations. Place the cursor on a declaration name or a referenced symbol. |
| Active Module | Follows reverse imports transitively and lists tests in dependent test modules, including side-effect imports, literal dynamic imports and CommonJS `require`. This broader scope includes all recognized cases in an affected file. |
| Git-Changed Modules | Uses the built-in Git extension’s staged, working-tree, untracked and merge changes, plus unsaved buffers in the active repository. Analyzes those modules against the active compiler project. Changes already committed to a branch are outside this scope. |

The searchable picker shows each potentially affected test, its file and an illustrative dependency chain. Select a result to open the test registration. Results are deduplicated, cycles terminate, and navigation checks the project snapshot to reject stale results. No tests run automatically.

Try [impactSource.ts](../../docs/structural-tools/demo/impactSource.ts): place the cursor on `formatImpactLabel` and choose **Function or Symbol at Cursor**. The two label tests in `impactSource.test.ts` appear, including the path through `displayImpactLabel`; the unrelated totals test is excluded. **Active Module** includes all three tests.

Test discovery recognizes `.test.*`, `.spec.*`, `test/`, `tests/`, and `__tests__/` paths, and files importing Node’s test API, Vitest, Jest globals, Playwright Test or Mocha. Literal `test`/`it` titles, imported aliases, suite titles, common modifiers and `.each(...)` registrations are supported. Module analysis falls back to a test file entry when no static cases are found. Parameterized registrations are listed once. Shared hooks and test-file initialization conservatively include every recognized case in that file.

Keep source and tests in the same compiler project; excluded test projects are not scanned. If the application config excludes tests, open a test file under a config that includes them and select the imported symbol there. Git mode reports changed files outside that project or deleted from it as unanalyzed. Computed module paths, reflection, custom registration wrappers, mocks, runtime global effects and anonymous declarations can require broader module analysis or additional tests. The report is a static candidate list and does not establish runtime coverage.

![Affected test cases with direct and transitive symbol reference chains](../../docs/structural-tools/screenshots/test-impact-analysis.png)

## Everyday Structural Tools

Run **TypeScript Structure: Open Structural Tools** for a searchable picker covering the analysis, refactoring and intention commands. The [quality-of-life guide](../../docs/structural-tools/QUALITY_OF_LIFE.md) shows remembered entry files and move destinations, clearable analysis results, test-impact search and matching clipboard exports, remembered impact scope, copyable dead-code/nullability reports, signature undo/redo and recovery from rejected previews with inline validation, grouped deletion reports, and flow-view filters with screenshots.
