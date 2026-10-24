/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export interface Job {
	id: string;
}

export interface BuildJob extends Job {
	name: string;
	status: 'queued' | 'complete';
}

export interface Owner {
	displayName: string;
}

export type OwnedBuild = BuildJob & { owner: Owner };
export type JobResult = BuildJob | { error: string };

// BuildJob is the shared model used by the build dashboard.
export const modelLabel = 'BuildJob';
