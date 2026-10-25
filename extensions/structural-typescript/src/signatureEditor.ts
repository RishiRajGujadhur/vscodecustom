/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Project } from './project';
import { Change } from './refactor';
import { currentSignature, changeSignature, SignatureParameter, SignatureError, SignatureErrorCode, validExpression, validParameterName } from './changeSignature';
import { projectSnapshot, sameSnapshot } from './snapshot';
import { parameterObject, validateChanges } from './globalRefactor';

const errors: Record<SignatureErrorCode, () => string> = {
	target: () => vscode.l10n.t('Select a Named Function, Method, Interface Method, or Explicit Constructor.'),
	parameters: () => vscode.l10n.t('This Parameter Shape, Shadowed Name, or Signature Family Is Not Supported. JavaScript Requires checkJs.'),
	migration: () => vscode.l10n.t('A New Required Parameter Needs an Explicit Migration Expression.'),
	callers: () => vscode.l10n.t('Indirect, Optional, Spread, Inherited Constructor, or Ambiguous Calls Prevent This Change.'),
	effects: () => vscode.l10n.t('Reordering or Removing These Arguments Could Change Evaluation Effects.'),
	syntax: () => vscode.l10n.t('The Proposed Signature or Migration Expression Is Invalid.'),
	bodyReference: () => vscode.l10n.t('A Removed Parameter Is Still Referenced by the Implementation or Another Parameter.'),
	dynamic: () => vscode.l10n.t('Arguments, Generators, Reflection, or Dynamic Calls Prevent This Change.')
};
export function registerChangeSignature(withProject: <T>(document: vscode.TextDocument, action: (project: Project) => T) => T, register: (id: string, action: (editor: vscode.TextEditor) => Promise<void>) => void, preview: (changes: readonly Change[]) => Promise<void>): void {
	register('structural.changeSignature', async editor => {
		try {
			const file = editor.document.uri.fsPath, offset = editor.document.offsetAt(editor.selection.active);
			const { signature, snapshot } = withProject(editor.document, project => ({ signature: currentSignature(project, file, offset), snapshot: projectSnapshot(project) }));
			const parameters: SignatureParameter[] = [...signature.parameters];
			const history: SignatureParameter[][] = [];
			const remember = () => { history.push([...parameters]); if (history.length > 50) { history.shift(); } };
			const nameError = (name: string) => validParameterName(name) && !parameters.some(parameter => parameter.name === name) ? undefined : vscode.l10n.t('Enter a Valid, Unique Parameter Name.');
			const expressionError = (text: string) => validExpression(text) ? undefined : vscode.l10n.t('Enter a Valid Expression.');
			const choose = async () => vscode.window.showQuickPick(parameters.map((parameter, index) => ({ label: `${index + 1}. ${parameter.name}`, description: parameter.type ?? parameter.originalType ?? vscode.l10n.t('Keep Original Type'), index })), { placeHolder: vscode.l10n.t('Choose a Parameter') });
			while (true) {
				const action = await vscode.window.showQuickPick([
					{ label: vscode.l10n.t('Preview Signature Changes'), id: 'preview' },
					{ label: vscode.l10n.t('Add Parameter'), id: 'add' },
					{ label: vscode.l10n.t('Edit Parameter'), id: 'edit' },
					{ label: vscode.l10n.t('Remove Parameter'), id: 'remove' },
					{ label: vscode.l10n.t('Move Parameter'), id: 'move' },
					{ label: vscode.l10n.t('Convert Current Signature to Options Object'), id: 'options' },
					...(history.length ? [{ label: vscode.l10n.t('Undo Last Parameter Edit'), id: 'undo' }, { label: vscode.l10n.t('Reset to Original Signature'), id: 'reset' }] : [])
				], { title: `${signature.name}(${parameters.map(parameter => parameter.name + (parameter.optional ? '?' : '') + (parameter.type ?? parameter.originalType ? ': ' + (parameter.type ?? parameter.originalType) : '') + (parameter.defaultValue ? ' = ' + parameter.defaultValue : '')).join(', ')})`, placeHolder: vscode.l10n.t('Only Callers in the Current Compiler Project Are Migrated. Escape Cancels.') });
				if (!action) { return; }
				if (action.id === 'undo') { parameters.splice(0, parameters.length, ...history.pop()!); continue; }
				if (action.id === 'reset') { remember(); parameters.splice(0, parameters.length, ...signature.parameters); continue; }
				if (action.id === 'preview' || action.id === 'options') {
					const result = withProject(editor.document, project => {
						if (!sameSnapshot(project, snapshot)) { throw new Error(vscode.l10n.t('The Project Changed While Editing the Signature. Start Again.')); }
						if (action.id === 'options') { const changes = parameterObject(project, file, offset); validateChanges(project, changes); return changes.map(change => ({ ...change, documentText: project.program.getSourceFile(change.fileName)!.text })); }
						return changeSignature(project, file, offset, parameters).changes;
					});
					await preview(result); return;
				}
				if (action.id === 'add') {
					const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t('New Parameter Name'), validateInput: nameError }); if (!name) { continue; }
					const type = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Parameter Type (TypeScript Only)'), value: 'unknown' }); if (type === undefined) { continue; }
					const mode = await vscode.window.showQuickPick([{ label: vscode.l10n.t('Required'), id: 'required' }, { label: vscode.l10n.t('Optional'), id: 'optional' }, { label: vscode.l10n.t('Defaulted'), id: 'default' }]); if (!mode) { continue; }
					let migrationValue: string | undefined, defaultValue: string | undefined;
					if (mode.id === 'required') { migrationValue = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Explicit Argument Expression for Existing Callers'), validateInput: expressionError }); if (!migrationValue?.trim()) { continue; } }
					if (mode.id === 'default') { defaultValue = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Default Parameter Expression'), validateInput: expressionError }); if (!defaultValue?.trim()) { continue; } }
					remember(); parameters.push({ name, type: type || undefined, optional: mode.id === 'optional', defaultValue, migrationValue }); continue;
				}
				const selected = await choose(); if (!selected) { continue; }
				if (action.id === 'remove') { remember(); parameters.splice(selected.index, 1); continue; }
				if (action.id === 'move') {
					const destination = await vscode.window.showInputBox({ prompt: vscode.l10n.t('New Position (1 to {0})', parameters.length), value: String(selected.index + 1), validateInput: value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= parameters.length ? undefined : vscode.l10n.t('Choose a Position from 1 to {0}.', parameters.length) });
					if (destination && /^\d+$/.test(destination) && Number(destination) >= 1 && Number(destination) <= parameters.length) { remember(); const [parameter] = parameters.splice(selected.index, 1); parameters.splice(Number(destination) - 1, 0, parameter); } continue;
				}
				const parameter = parameters[selected.index];
				const field = await vscode.window.showQuickPick([{ label: vscode.l10n.t('Rename'), id: 'name' }, { label: vscode.l10n.t('Change Type'), id: 'type' }, { label: vscode.l10n.t('Make Optional'), id: 'optional' }, { label: vscode.l10n.t('Make Required'), id: 'required' }, { label: vscode.l10n.t('Set Default Expression'), id: 'default' }, { label: vscode.l10n.t('Clear Default Expression'), id: 'clearDefault' }, { label: vscode.l10n.t('Set Migration Expression for Added Parameter'), id: 'migration' }]);
				if (!field) { continue; }
				if (field.id === 'optional') { remember(); parameters[selected.index] = { ...parameter, optional: true, defaultValue: null }; continue; }
				if (field.id === 'required') { remember(); parameters[selected.index] = { ...parameter, optional: false, defaultValue: null }; continue; }
				if (field.id === 'clearDefault') { remember(); parameters[selected.index] = { ...parameter, defaultValue: null }; continue; }
				const text = await vscode.window.showInputBox({ prompt: field.label, value: field.id === 'name' ? parameter.name : field.id === 'type' ? parameter.type ?? parameter.originalType ?? '' : field.id === 'default' ? parameter.defaultValue ?? '' : parameter.migrationValue ?? '', validateInput: value => field.id === 'name' ? validParameterName(value) && !parameters.some((other, index) => index !== selected.index && other.name === value) ? undefined : vscode.l10n.t('Enter a Valid, Unique Parameter Name.') : field.id === 'default' || field.id === 'migration' ? expressionError(value) : undefined });
				if (text === undefined) { continue; }
				remember(); parameters[selected.index] = field.id === 'name' ? { ...parameter, name: text } : field.id === 'type' ? { ...parameter, type: text || undefined } : field.id === 'default' ? { ...parameter, defaultValue: text, optional: false } : { ...parameter, migrationValue: text };
			}
		} catch (error) { if (error instanceof SignatureError) { throw new Error(errors[error.code]()); } throw error; }
	});
}
