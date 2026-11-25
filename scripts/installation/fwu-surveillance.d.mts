// Types de scripts/installation/fwu-surveillance.mjs (pour le test du site).
export interface ProcessObservation { online: boolean; restarts: number }
export interface SurveillanceObservation {
  processes: Record<string, ProcessObservation> | null;
  outbox: number | null;
  diskPercent: number | null;
  backup: { ok: boolean; at?: number; step?: string } | null;
}
export interface SurveillanceState { [key: string]: unknown }
export const PROCESSES: ReadonlyArray<{ name: string; label: string }>;
export const DOWN_GRACE_MS: number;
export const OUTBOX_LIMIT: number;
export const DISK_LIMIT_PERCENT: number;
export const BACKUP_MAX_AGE_MS: number;
export const FLAP_RESTARTS: number;
export function evaluate(previous: SurveillanceState | undefined, observed: SurveillanceObservation, now?: number): { state: SurveillanceState; messages: string[] };
export function parsePm2List(text: string): Record<string, ProcessObservation> | null;
