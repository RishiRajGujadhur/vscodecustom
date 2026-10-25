# Structural Tools Code Review — 25 October 2026

The review covered Move Module Members, Find Dead Code, Advanced Nullability Analysis, Test Impact Analysis, Change Signature, Safe Delete, Function Data Flow, and Advanced Intention Actions. Reproduced defects were fixed and captured in regression tests.

## Fixes

| Area | Reproduced defect and correction |
| --- | --- |
| Move Module Members | Combined TypeScript insertions and deletions at the same offset were rejected as overlapping. Edits at the same offset now compose before validation. Equivalent directive quotes are compared by directive value, and only the directive prologue participates. The project snapshot is rechecked after confirmation. |
| Find Dead Code | Reads in unreachable files incorrectly kept exports alive. Only entry-reachable modules now contribute live roots. Literal CommonJS loads participate in module reachability; untyped CommonJS exports are retained conservatively. Eager static class initialization retains dependencies, and missing entry files are rejected. |
| Advanced Nullability Analysis | A property name such as nullable could make an unrelated type error look null-related. General assignment/argument errors now require an actual null/undefined type diagnostic. Tests also verify that genuine nullable assignments, arguments and accesses remain reported. |
| Test Impact Analysis | Dynamic test titles could disappear when static cases shared a file. They now produce a test-file candidate. Ordinary object methods and local functions named test are distinguished from supported registration APIs; namespace APIs and Node test contexts retain their cases. |
| Change Signature | Removing an unused parameter could silently remove an effectful default initializer. Such removals are now refused; literal defaults remain supported. TypeScript .mts/.cts parameter types are preserved. |
| Safe Delete | Class member decorators and computed names could execute effects that were overlooked. Those declarations now block deletion. Known local declaration-file references block symbol and module deletion. |
| Function Data Flow | Keyword operators such as in were misclassified as assignments by an unbounded token comparison. The assignment range is now bounded. Bracket writes, property increments and deletion are retained as mutation sites. Unsupported destructuring writes fail explicitly. |
| Advanced Intention Actions | Guard Clause could move a fallback return outside an unbraced outer branch. That context is now refused. Ambient/global reads that can invoke host getters are no longer considered pure for repeated-expression extraction. |
| Shared project and preview handling | The nearest tsconfig/jsconfig is selected correctly, jsconfig defaults are honored, and loose files do not inherit the extension host's unrelated project. Snapshots include local declaration files. Older diagnostic requests cannot overwrite newer results. Mixed line endings normalized by the editor have their offsets mapped before preview, diagnostics or navigation; real text changes still invalidate the result. |

## Verification

- All 151 tests passed in the working checkout. Compiler checks run through the extension test script; targeted ESLint covers all modified source files.
- The full extension suite and the added edge-case tests cover callers, aliases, barrels, recursive groups, public entry exports, class initialization, JavaScript checking, nullable control flow, dynamic test titles, test contexts, module cycles, unsafe signature removals, deletion blockers and unsupported flow constructs.
- A module-move execution test runs original and transformed CommonJS modules and compares their values across local dependencies and aliased consumers.
- Extension bundling completed successfully. Live custom-build checks use an isolated fixture repository for Git-changed test discovery and deliberately change files during review to verify stale-result rejection.
- Editor line-ending normalization is checked in both offset directions and is explicitly distinguished from real content edits.

Run the complete suite from the repository root:

```powershell
npm run test --prefix extensions/structural-typescript
```

The focused regression cases are in projectTools.test.mts and safetyReview.test.mts. See the [testing walkthrough](README.md) for interactive scenarios.

## Scope

This verification covers the supported static analysis and transformation paths. Computed module loading, reflection, custom test wrappers, external consumers and unsupported syntax retain the limitations documented in the walkthrough. Passing tests do not establish exhaustive runtime coverage.
