/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export function formatImpactLabel(value: string): string {
	return value.trim().toUpperCase();
}

export function unrelatedTotal(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0);
}
