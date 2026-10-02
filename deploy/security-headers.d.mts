export type App = 'web' | 'console' | 'table';
export interface HeaderOptions { embed?: boolean; target?: 'vercel' | 'nginx' }
export function cspFor(app: App, o?: HeaderOptions): string;
export function headersFor(app: App, o?: HeaderOptions): { key: string; value: string }[];
export function vercelHeaders(app: App): { source: string; headers: { key: string; value: string }[] }[];
export function nginxHeaders(app: App, embed?: boolean): string;
export function metaCsp(app: App, env: { apiUrl?: string; webUrl?: string }): string | null;
export function cspMetaPlugin(app: App): import('vite').Plugin;
