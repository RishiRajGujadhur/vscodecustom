/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from "node:test";
import { formatImpactLabel, unrelatedTotal } from "./impactSource";
import { displayImpactLabel } from "./impactAdapter";

test("formats a label directly", () => {
	if (formatImpactLabel(" ready ") !== "READY") { throw new Error("Unexpected label"); }
});

test("formats a label through the adapter", () => {
	if (displayImpactLabel(" ready ") !== "[READY]") { throw new Error("Unexpected display label"); }
});

test("adds unrelated totals", () => {
	if (unrelatedTotal([1, 2]) !== 3) { throw new Error("Unexpected total"); }
});
