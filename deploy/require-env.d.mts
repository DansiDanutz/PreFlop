export function missingBuildEnv(mode: string, env: Record<string, string | undefined>, names?: readonly string[]): string[];
export function requireBuildEnv(names?: readonly string[]): import('vite').Plugin;
