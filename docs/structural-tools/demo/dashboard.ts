/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { formatBuild } from './formatBuild';
import { BuildJob } from './models';

export const currentBuild: BuildJob = {
	id: 'build-42',
	name: 'Structural Tools Preview',
	status: 'complete'
};

export const heading = formatBuild(currentBuild.name, 3);
export const footer = formatBuild('Previous Release', 12);
