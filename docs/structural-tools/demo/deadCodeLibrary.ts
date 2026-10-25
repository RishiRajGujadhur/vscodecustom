export function activeLabel() { return "Alive"; }

export function unusedLabel() { return recursiveHelper(); }
function recursiveHelper(): string { return unusedLabel(); }

export const UnusedPanel = () => "Unused component";
