export type DiskMount = { fs: string; sizeKb: number; usedKb: number; availKb: number; pct: number; mount: string };
export type DiskUsage = { ok: boolean; mounts: DiskMount[]; error?: string };
