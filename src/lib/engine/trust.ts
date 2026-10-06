// Trust Score: 0–100, built only from things the reviewer can see.
// 100, minus a fixed amount per anomaly and per missing field (by severity),
// minus a penalty for low average extraction confidence.

import type { Severity } from '../types';

export const ANOMALY_PENALTY: Record<Severity, number> = { high: 15, medium: 7, low: 3 };
export const MISSING_PENALTY: Record<Severity, number> = { high: 8, medium: 5, low: 2 };
/** Points lost per 1.0 of missing average confidence (avg 0.9 -> 4 points). */
export const CONFIDENCE_WEIGHT = 40;

export interface TrustInput {
  anomalies: Array<{ severity: Severity }>;
  missing: Array<{ severity: Severity }>;
  confidences: number[];
}

export interface TrustBreakdown {
  score: number;
  parts: Array<{ label: string; points: number }>;
}

export function trustScore(input: TrustInput): TrustBreakdown {
  const parts: TrustBreakdown['parts'] = [];
  for (const sev of ['high', 'medium', 'low'] as const) {
    const n = input.anomalies.filter((a) => a.severity === sev).length;
    if (n) parts.push({ label: `${n} ${sev} anomal${n === 1 ? 'y' : 'ies'}`, points: -n * ANOMALY_PENALTY[sev] });
  }
  for (const sev of ['high', 'medium', 'low'] as const) {
    const n = input.missing.filter((m) => m.severity === sev).length;
    if (n) parts.push({ label: `${n} missing ${sev}-priority field${n === 1 ? '' : 's'}`, points: -n * MISSING_PENALTY[sev] });
  }
  if (input.confidences.length) {
    const avg = input.confidences.reduce((s, c) => s + c, 0) / input.confidences.length;
    const pts = Math.round((1 - avg) * CONFIDENCE_WEIGHT);
    if (pts) parts.push({ label: `average confidence ${Math.round(avg * 100)}%`, points: -pts });
  }
  const score = Math.max(0, Math.min(100, 100 + parts.reduce((s, p) => s + p.points, 0)));
  return { score, parts };
}

export function trustTone(score: number | null | undefined): 'good' | 'fair' | 'poor' | 'none' {
  if (score == null) return 'none';
  if (score >= 80) return 'good';
  if (score >= 60) return 'fair';
  return 'poor';
}
