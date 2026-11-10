export const MAX_SKIPPED_COMMITS: number;
export function vercelProjectOf(siteUrl: string): string | null;
export function skippedByVercel(statuses: unknown, project: string): boolean;
export function vercelSkippedEvery(
  commits: readonly string[],
  project: string | null,
  options?: { repo?: string; token?: string; fetchImpl?: (url: string | URL, init?: RequestInit) => Promise<Response> },
): Promise<boolean>;
