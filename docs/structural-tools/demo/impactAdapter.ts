/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { formatImpactLabel } from "./impactSource";

export function displayImpactLabel(value: string): string {
	return "[" + formatImpactLabel(value) + "]";
}
