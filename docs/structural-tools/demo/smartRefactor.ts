/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export function formatName(first: string, last: string) {
	return first + last;
}

export function discountPrice(premium: boolean) {
	let discount = 0;
	if (premium) {
		discount = 20;
	}
	const price = 100 - discount;
	return price;
}

export function createUser(name: string, age: number) {
	return { name, age };
}

export const exampleUser = createUser('Alex', 25);

export function cleanupExample() {
	const obsolete = 1;
	return 'kept';
}
