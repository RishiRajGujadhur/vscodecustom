/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export type RefactorErrorCode = 'invalidComponentName' | 'invalidSelection' | 'unsafeSelection' | 'reservedProp' | 'rootKey' | 'invalidIdentifier'
	| 'unsupportedFunction' | 'unsupportedParameters' | 'argumentsReference' | 'optionsConflict' | 'indirectReference' | 'invalidCaller'
	| 'nestedCall' | 'invalidMember' | 'genericMember' | 'unsafeMember' | 'invalidTarget' | 'existingMember' | 'missingSource' | 'overlappingEdits' | 'missingProject' | 'unsupportedObjectParameter' | 'objectCallerOrder';

/** Domain errors are localized by the extension UI, without depending on VS Code in the compiler. */
export class RefactorError extends Error {
	constructor(readonly code: RefactorErrorCode) { super(code); }
}
