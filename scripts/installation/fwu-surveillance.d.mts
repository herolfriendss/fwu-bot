// Types de scripts/installation/fwu-surveillance.mjs (pour le test du site).
export interface ProcessObservation { online: boolean; ready?: boolean; restarts: number; pid?: number | null }
export interface SurveillanceObservation {
  processes: Record<string, ProcessObservation> | null;
  outbox: number | null;
  diskPercent: number | null;
  memoryPercent?: number | null;
  load1?: number | null;
  cpuCount?: number | null;
  backup: { ok: boolean; at?: number; step?: string } | null;
}
export interface SurveillanceState { [key: string]: unknown }
export const PROCESSES: ReadonlyArray<{ name: string; label: string; marker?: string; optional?: boolean }>;
export const DOWN_GRACE_MS: number;
export const OUTBOX_LIMIT: number;
export const DISK_LIMIT_PERCENT: number;
export const BACKUP_MAX_AGE_MS: number;
export const FLAP_RESTARTS: number;
export const MEMORY_LIMIT_PERCENT: number;
export const MEMORY_RECOVERY_PERCENT: number;
export const LOAD_LIMIT_PER_CPU: number;
export const LOAD_RECOVERY_PER_CPU: number;
export const RESOURCE_GRACE_MS: number;
export function evaluate(previous: SurveillanceState | undefined, observed: SurveillanceObservation, now?: number): { state: SurveillanceState; messages: string[] };
export function parsePm2List(text: string): Record<string, ProcessObservation> | null;

export function connectedMarkerMatchesPid(markerContent: string, pid: number | null | undefined): boolean;
export function applyMarkerReadiness(processes: Record<string, ProcessObservation> | null, markerStatus?: Record<string, boolean>): Record<string, ProcessObservation> | null;
