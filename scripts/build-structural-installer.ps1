# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
	function Invoke-Checked([scriptblock] $Action) {
		& $Action
		if ($LASTEXITCODE -ne 0) { throw "Build command failed with exit code $LASTEXITCODE" }
	}
	$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
	if (!(Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio with the Desktop development with C++ workload before building.' }
	$visualStudio = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
	if (!$visualStudio) { throw 'No Visual Studio C++ toolchain found.' }
	$env:vs2022_install = $visualStudio
	$sdk = Get-ChildItem 'C:/Program Files (x86)/Windows Kits/10/bin' -Directory | Sort-Object Name -Descending | Where-Object { Test-Path (Join-Path $_.FullName 'x64/signtool.exe') } | Select-Object -First 1
	if (!$sdk) { throw 'Install the Windows SDK signing tools before building.' }
	$env:PATH = "$(Join-Path $sdk.FullName 'x64');$env:PATH"
	Invoke-Checked { node build/npm/preinstall.ts }
	Invoke-Checked { npm ci }
	Invoke-Checked { npm --prefix extensions/structural-typescript test }
	Invoke-Checked { npm run gulp vscode-win32-x64-min }
	$extensionPath = Join-Path (Split-Path (Get-Location) -Parent) 'VSCode-win32-x64/resources/app/extensions/structural-typescript'
	if (!(Test-Path (Join-Path $extensionPath 'dist/extension.js'))) { throw 'Packaged application is missing the structural extension.' }
	if (!(Test-Path (Join-Path $extensionPath 'dist/lib.d.ts'))) { throw 'Packaged application is missing the TypeScript standard library.' }
	Invoke-Checked { npm run gulp vscode-win32-x64-inno-updater }
	Invoke-Checked { npm run gulp vscode-win32-x64-user-setup }
	$installers = @(Get-ChildItem '.build/win32-x64/user-setup/*.exe')
	if (!$installers.Count) { throw 'The installer build did not produce an executable.' }
	$installers | ForEach-Object { "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)" } | Set-Content '.build/win32-x64/user-setup/SHA256SUMS.txt'
} finally {
	Pop-Location
}
