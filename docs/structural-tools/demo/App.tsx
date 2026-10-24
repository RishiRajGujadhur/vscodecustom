/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use client';
import { useEffect, useState } from 'react';

export function App() {
	const title = 'Build Monitor';
	const [count, setCount] = useState(3);
	const [steps] = useState(['Compile', 'Refactor', 'Review']);

	useEffect(() => {
		console.log('Build count changed', count);
	}, [count]);

	return (
		<main>
			<section>
				<h2>{title}</h2>
				<p>Successful builds: {count}</p>
			</section>
			<button onClick={() => setCount(count + 1)}>Add Build</button>
			{count > 0 && <strong>Ready for review</strong>}
			<ul>
				{steps.map(step => <li key={step}>{step}</li>)}
			</ul>
		</main>
	);
}
