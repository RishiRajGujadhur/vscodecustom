# Code OSS — Structural Tools

A custom Code OSS build with JetBrains-inspired tools for React and TypeScript. The built-in **TypeScript Structure Tools** extension adds extraction, rename previews, JSX navigation, refactorings across files, and dependency analysis.

[Testing walkthrough](docs/structural-tools/README.md) · [Release notes](docs/structural-tools/RELEASE_NOTES.md) · [Extension reference](extensions/structural-typescript/README.md)

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
