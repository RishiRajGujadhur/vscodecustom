# Testing Structural Tools

These screenshots show the custom Windows Code OSS build with its built-in **TypeScript Structure Tools** extension. They were captured from the running application using an isolated profile and a copy of [demo](demo). The demo is an editing fixture, not a runnable React application; `react.d.ts` supplies small local declarations so no dependency installation is needed.

Copy the demo folder to a writable location and use **File → Open Folder** to open it. Open the Command Palette with `Ctrl+Shift+P`; the commands below start with **TypeScript Structure:**. If asked, trust only a folder whose contents you have reviewed. Run each example on a fresh copy, or discard its preview before continuing. Analysis trees are snapshots: rerun the command after editing.

## 1. JSX structure and breadcrumbs

Open `App.tsx`. Expand **React Structure** in Explorer. Expect `App`, both `useState` hooks, `useEffect`, nested JSX, `count > 0 &&`, and `steps.map(…)`. Click `<li>` to navigate; the breadcrumb includes its JSX and map ancestry. If another document-symbol source is selected, choose **React Structure** as the Outline source.

![React Structure and breadcrumbs](screenshots/react-structure.png)

## 2. Component extraction and rename

In `App.tsx`, select lines 19–22, from `<section>` through `</section>`, then run **Extract React Component**. Enter `CounterPanel`. The preview should create an adjacent `CounterPanel.tsx`, preserve `'use client'`, infer props for `title` and `count`, insert an import, and replace the section with `<CounterPanel title={title} count={count} />`. A literal type for the constant title is expected.

The screenshot shows the result after approving the complete extraction, with the updated source and generated component side by side.

![Component extraction](screenshots/extract-component.png)

Edits requiring confirmation start unchecked. Check both file groups in **Refactor Preview**, including the new file, then inspect the proposed changes before choosing **Apply**. **Discard** leaves the original files untouched. Approve the whole related change together; partial approval can leave imports, callers, or generated files inconsistent. Extraction copies imports, so **Organize Imports** can remove unused ones afterward.

To test rename on a fresh copy, put the cursor inside the `BuildJob` declaration in `models.ts`. Run **Rename with Text Reference Preview**, enter `BuildTask`, and choose **Symbol, String and Comment References**. Expect semantic references in `models.ts` and `dashboard.ts`, plus the matching comment and `modelLabel` string. **Symbol References** excludes those text matches. **Include Workspace Text Matches in Other File Types** adds heuristic matches outside the compiler program; review them for unrelated words.

## 3. Global refactorings

Open `formatBuild.ts`, click the `formatBuild` identifier, and run **Extract Parameter Object and Update Callers**. Expect `formatBuildOptions`, a destructured parameter, and object arguments for both calls in `dashboard.ts`. Check both file groups, inspect the diffs, then apply or discard.

![Parameter conversion with caller updates](screenshots/parameter-object.png)

After applying the complete conversion, run **Inline Parameter Object and Update Callers** inside the function to test the reverse conversion. It requires supported object-literal callers. On a fresh demo, click the `name` member in `BuildJob` and run **Pull Member Up**: the preview moves it to `Job`. After applying that complete change, **Push Member Down** on `Job.name` previews moving it back to the direct child. Review each operation before applying it.

## 4. Type and possible value dependencies

In `models.ts`, click directly inside the **OwnedBuild** identifier, then run **Show Type Dependencies**. Expand `OwnedBuild` and `BuildJob` in **Type and Value Dependencies**. Expect `BuildJob`, `Owner`, and `Job`. Use the expansion arrow; clicking a node's label navigates to its source. Run **Show Type Dependents** on `Job` to explore the reverse direction. The native **Show Type Hierarchy** command supports class/interface inheritance.

![Intersection and inheritance dependencies](screenshots/type-dependencies.png)

Open `valueFlow.ts` and click `validatedCount` in its declaration. Run **Show Possible Value Flow to Here** to inspect its input, or **Show Possible Value Flow from Here** to inspect its uses. Expand nodes as needed. This traces explicit static relationships, not recorded runtime execution. **Analyze Project Types and Unused Declarations** publishes review hints in Problems; a hint alone is not proof that a public API can be removed.

## Scope and installation notes

The commands use the active file's nearest TypeScript/JavaScript project, including unsaved documents. Unsupported or ambiguous transformations stop with an explanation. Computed dynamic imports, runtime aliasing, reflection, and unrelated project boundaries are not fully modeled. See the [extension reference](../../extensions/structural-typescript/README.md) for the precise restrictions.

The Windows x64 user installer is unsigned. The installer path fix removes an unfiltered duplicate dependency tree that caused `MoveFile failed; code 3` at the default user install path. Packaging now checks path lengths with rename headroom. Native Inno Setup probes covered both fresh copies and overwriting existing files at representative long paths. React Structure remains accessible in Explorer when switching between JSX and other files; an unsupported active file has an empty structure tree.
