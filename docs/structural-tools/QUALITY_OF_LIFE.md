# Everyday Structural Tools

These improvements apply to the eight structural feature areas and keep the existing validation and edit previews in place.

## Find the right tool

Run **TypeScript Structure: Open Structural Tools**. The native picker groups analysis, refactoring and results commands, with a short description of each. Search by a task such as “undefined”, “callers”, “tests” or “delete”. **Advanced Intention Actions** opens refactoring suggestions at the cursor; the normal Ctrl+. shortcut remains available.

![Searchable structural tool picker](screenshots/structural-toolbox.png)

## Repeat analysis with less setup

**Find Dead Code** remembers the selected entry files for each compiler project in this workspace. The first run preselects the active source file. Subsequent runs restore surviving entry files; if none remain, the active file is selected again. You can change the checked entries on every run.

**Move Module Members** puts the last validated destination for that source directory first and labels it **Last Destination**. The move retains the source selection from command invocation and stops if that document changes while choosing a destination. Selecting a destination does not apply edits: review the warning and Refactor Preview as before.

**Test Impact Analysis** remembers the last successfully analyzed scope for this workspace, labels it **Last Scope**, and puts it first. You can still select any scope on each run.

Run **Clear Analysis Results** from the palette or tool picker to clear structural dead-code, nullability and older unused-analysis diagnostics, plus dependency trees. Other extensions' Problems entries remain available. Your saved entry choices are retained.

## Search and copy affected tests

The Test Impact Analysis result picker searches test titles, workspace-relative file paths and dependency-chain names. Search is case insensitive; every space-separated word must match somewhere in those fields. The title shows the matching count out of the full result count. **Clear Search** restores all results.

The toolbar has **Copy Matching Test File Paths** and **Copy Matching Impact Report** buttons. Hover the icons to see their labels. Paths are unique and workspace relative, one per line; reports include test names, paths and dependency chains. Both export only the current matching results without closing the picker. Clear the search to export all results. If nothing matches, copy leaves the clipboard unchanged and shows an explanation. Copying and opening a selected test both revalidate the project snapshot. If source or compiler settings changed, rerun analysis; stale results cannot replace the clipboard.

![Test impact copy actions](screenshots/test-impact-copy.png)

## Copy analysis findings

Run **TypeScript Structure: Copy Last Analysis Report** from the command palette or **Open Structural Tools** after **Find Dead Code** or **Advanced Nullability Analysis** completes. It copies the latest completed report, including workspace-relative paths, one-based line and column numbers, finding messages and nullability source/path/return traces. A successful analysis with no findings copies a report saying **No Findings**. You can copy while a report or another non-source editor is active.

Editing a document, creating/deleting/renaming files, or running **Clear Analysis Results** invalidates the saved report. Run analysis again before copying. Other tools do not replace this report. Copy also rechecks the full compiler-project snapshot, including unopened files and compiler settings, to catch external changes that did not raise an editor event. Superseded analysis runs cannot clear a newer run’s diagnostics.

## Edit signatures with undo and redo

The Change Signature editor displays original TypeScript types and default expressions in its current-signature title and parameter choices. Displaying an original type does not force every overload to use the implementation's type.

After an edit, choose **Undo Last Parameter Edit** to step back, **Redo Parameter Edit** to restore an undone step, or **Reset to Original Signature** to restore the starting draft. Reset itself can be undone. Making a new edit after undo clears the redo branch. The most recent fifty editing steps are retained for that invocation. Nothing changes in source until you preview and approve the refactoring.

Parameter names are checked for syntax and duplicates while typing. Default and caller-migration expressions are checked for expression syntax, and parameter positions are checked against the current list. Compiler validation and caller-effect checks still run when creating the preview. If validation rejects a draft, choose **Continue Editing** in the error notification to return to that draft with undo/redo history intact. Dismissing the notification cancels the operation. If the project changed during editing, start again with a fresh snapshot.

![Signature editor with undo and reset](screenshots/signature-undo.png)

## Scan deletion blockers quickly

The Safe Delete review starts with counts of blocking references, removable imports and risks. Blocking references come first, followed by removable imports. Each link includes its source line, so you can identify the usage before navigating. Known blockers and initialization effects still prevent deletion.

## Focus the flow view

If the cursor is not on a tracked local variable, Function Data Flow offers a variable picker with declaration line numbers, plus **Whole Function** for a view without a variable overlay. If the cursor already identifies a variable, its values and reaching assignments are shown immediately.

The view summarizes node counts, unreachable nodes and possible unassigned reads. **Filter Nodes** searches the displayed node text, including statements, variables and values. **Show Unreachable Nodes** controls whether dimmed unreachable cards are visible. The live count shows how many cards match; clearing the search restores them. Filtering does not change the compiler analysis or the mutation list. Editing the source still closes its stale flow view. **Go to Reaching Value Origins** also stops navigation if the source changes while choosing an assignment.

![Flow analysis with variable overlay and filter controls](screenshots/flow-controls.png)

## Verify the improvements

1. Open the [demo](demo), run **Open Structural Tools**, and search for “undefined”. The nullability tool should remain in the list.
2. Run Find Dead Code with only deadCodeEntry.ts checked. Cancel and reopen the picker from another file in the same project: that entry selection should be restored. Run **Clear Analysis Results** and verify the structural diagnostics disappear.
3. Analyze formatImpactLabel in impactSource.ts with **Function or Symbol at Cursor**. Search “adapter”: expect one of two results, and copy the matching report to verify only that test appears. Search “displayImpactLabel impactSource.test” to match words across the dependency chain and file path. Search a nonexistent term and click copy: the previous clipboard should survive. Clear the search and copy paths: impactSource.test.ts should appear once. Reopen analysis and verify **Last Scope** appears first.
4. Run Change Signature on createUser in smartRefactor.ts and remove age from the draft. Preview should reject its remaining body reference. Choose **Continue Editing**: the one-parameter draft should remain. Undo restores both parameters and their types; redo removes age again. Undo, make a different edit, and verify the old redo action disappears. Add a parameter and try the reserved name “class”: validation should keep the name input open with an error. Escape cancels the draft.
5. Run Function Data Flow on the discountPrice function name. Select discount, search for a nonexistent term, and expect zero visible cards. Clear the search to restore all cards; toggle unreachable-node visibility as needed.
6. Run Safe Delete Symbol on createUser. The report should show its blocking exampleUser caller in the first reference group and refuse deletion.
7. Run Advanced Nullability Analysis on nullabilityPaths.ts, then **Copy Last Analysis Report**. Paste into a scratch document and verify the unsafe read and related source traces include paths and line/column numbers. Repeat after Find Dead Code to check it replaces the report. Clear results and try copying again: expect a prompt to run analysis first. Editing source should also invalidate the report.

Automated coverage includes search across fields, multiple-word matching, filtered path deduplication, signature draft recovery with undo/redo and branch replacement, and analysis report locations, traces, replacement and invalidation. Validation passed the full 155-test extension suite plus the additional report regression, targeted lint, type checks and bundling. Existing screenshots illustrate the native surfaces; fresh live UI verification was blocked by the environment’s automatic approval policy during this follow-up. See the [full testing walkthrough](README.md) for the underlying feature scenarios.

## Stale-result regression checks

- Run Test Impact Analysis, leave its results open, change a project file externally, and click a copy action. Expect an error asking you to rerun analysis and an unchanged clipboard. This also applies to unsaved source changes.
- Run a dead-code or nullability analysis, then externally edit an unopened project source file or change compiler settings. **Copy Last Analysis Report** should reject the stale snapshot and clear its cached report.
- Invoke Move Module Members with an export selected, then change only the source selection while choosing a destination. The preview should still use the original export. If source text changes instead, the move must stop before generating edits.
- Start another analysis while a previous run is loading its findings. When the older run finishes, newer diagnostics must remain.
- Open **Go to Reaching Value Origins**, edit source before choosing an origin, then select it. Navigation should stop and ask you to run the command again.

These cases have automated regression coverage in the extension suite. The follow-up audit passed all 158 tests, extension/test compilation, targeted lint and bundling. Live editor checks were not rerun during this audit.
