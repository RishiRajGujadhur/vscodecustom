/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Minimal editing-only declarations: this fixture does not run a React application.
declare module 'react' {
	export function useState<T>(initial: T): [T, (value: T) => void];
	export function useEffect(effect: () => void, dependencies: readonly number[]): void;
}

declare namespace JSX {
	interface Element { }
	interface ElementChildrenAttribute { children: {}; }
	interface Props {
		children?: Element | Element[] | string | number | boolean | (string | number)[];
		key?: string;
		onClick?: () => void;
	}
	interface IntrinsicElements {
		main: Props;
		section: Props;
		h2: Props;
		p: Props;
		button: Props;
		strong: Props;
		ul: Props;
		li: Props;
	}
}
