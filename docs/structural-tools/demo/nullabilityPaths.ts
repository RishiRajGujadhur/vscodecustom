export function lookupLabel(found: boolean): string | undefined {
	if (found) { return "Ready"; }
	return undefined;
}

export function inspectLabel(found: boolean) {
	const label = lookupLabel(found);
	const unsafeLength = label.length; // Reported: possibly undefined

	if (label !== undefined) {
		console.log(label.length); // Safe on this execution path
	}
	return label?.length ?? unsafeLength; // Guarded access and fallback
}
