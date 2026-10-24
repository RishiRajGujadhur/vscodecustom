/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { RefactorErrorCode } from './errors';

export function errorMessage(code: RefactorErrorCode): string {
	switch (code) {
		case 'invalidComponentName': return vscode.l10n.t('Use a component name beginning with an uppercase letter.');
		case 'invalidSelection': return vscode.l10n.t('Select exactly one complete JSX element or fragment.');
		case 'unsafeSelection': return vscode.l10n.t('This selection contains context-dependent code or mutations and cannot be extracted safely.');
		case 'reservedProp': return vscode.l10n.t('Rename closure variables named key or ref before extraction because React treats these props specially.');
		case 'rootKey': return vscode.l10n.t('Selections with a root key or spread require manual extraction to preserve React reconciliation.');
		case 'invalidIdentifier': return vscode.l10n.t('Enter a valid identifier.');
		case 'unsupportedFunction': return vscode.l10n.t('Select a named function with at least two required parameters and no type parameters.');
		case 'unsupportedParameters': return vscode.l10n.t('Overloads, destructuring, optional, default, rest and this parameters are not supported.');
		case 'argumentsReference': return vscode.l10n.t('Functions using arguments cannot be converted safely.');
		case 'optionsConflict': return vscode.l10n.t('The generated options type name is already in use.');
		case 'indirectReference': return vscode.l10n.t('The function has indirect references. Convert these to direct calls first.');
		case 'invalidCaller': return vscode.l10n.t('Every caller must pass exactly the required positional arguments without spreads.');
		case 'nestedCall': return vscode.l10n.t('Nested calls require separate conversion.');
		case 'invalidMember': return vscode.l10n.t('Select a named class or interface member.');
		case 'genericMember': return vscode.l10n.t('Generic containers, constructors and index signatures cannot be moved.');
		case 'unsafeMember': return vscode.l10n.t('Private, override, decorated, initialized and super-dependent members cannot be moved.');
		case 'invalidTarget': return vscode.l10n.t('No unambiguous compatible inheritance target was found.');
		case 'existingMember': return vscode.l10n.t('A destination already declares this member.');
		case 'missingSource': return vscode.l10n.t('A refactoring source file could not be read.');
		case 'overlappingEdits': return vscode.l10n.t('The refactoring contains overlapping edits.');
		case 'missingProject': return vscode.l10n.t('The active file is not included in an analyzable TypeScript or JavaScript project.');
		case 'unsupportedObjectParameter': return vscode.l10n.t('Select a non-overloaded function with one destructured object parameter containing required, unaliased fields.');
		case 'objectCallerOrder': return vscode.l10n.t('Every caller must use an object literal with fields in parameter order to preserve evaluation order.');
	}
}
