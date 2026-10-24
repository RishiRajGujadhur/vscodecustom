/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export const inputCount = 3;
const validatedCount = inputCount;

function doubleCount(count: number) {
	return count * 2;
}

export const totalCount = doubleCount(validatedCount);
