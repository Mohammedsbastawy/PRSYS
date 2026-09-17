// SLA / OLA computation (GLPI-style TTA & TTR targets). Pure — no prisma, safe for client use.

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export type Priority = (typeof PRIORITIES)[number]

export interface SLATargetRow {
  Priority: string
  ResponseMins: number
  ResolveMins: number
}

// ---- target units ------------------------------------------------------------------
// SLATargets stores minutes only (that is what computeDueDates needs), but admins
// think in hours/days. These helpers convert at the edges of the editor, so there is
// no schema change and every consumer keeps reading minutes.

export const SLA_UNITS = ["MINUTES", "HOURS", "DAYS"] as const;
export type SlaUnit = (typeof SLA_UNITS)[number];

/** wall-clock units — a "day" is 24h, matching the no-business-hours model */
export const UNIT_FACTOR: Record<SlaUnit, number> = { MINUTES: 1, HOURS: 60, DAYS: 24 * 60 };
export const UNIT_LABEL: Record<SlaUnit, string> = { MINUTES: "minutes", HOURS: "hours", DAYS: "days" };

/** API cap is 525600 minutes (= 365 days) */
export const MAX_SLA_MINUTES = 525600;

/** value + unit → whole minutes, or null when the pair does not land on a whole minute */
export function toMinutes(value: number, unit: SlaUnit): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const mins = value * UNIT_FACTOR[unit];
  const rounded = Math.round(mins);
  if (Math.abs(mins - rounded) > 1e-9) return null; // e.g. 0.2 minutes
  return rounded;
}

/** minutes → the largest unit that divides evenly, so 2880 comes back as "2 days" */
export function fromMinutes(mins: number | null | undefined): { value: string; unit: SlaUnit } {
  if (!mins || mins <= 0) return { value: "", unit: "HOURS" };
  if (mins % UNIT_FACTOR.DAYS === 0) return { value: String(mins / UNIT_FACTOR.DAYS), unit: "DAYS" };
  if (mins % UNIT_FACTOR.HOURS === 0) return { value: String(mins / UNIT_FACTOR.HOURS), unit: "HOURS" };
  return { value: String(mins), unit: "MINUTES" };
}

/** accepts "1.5" and the Arabic-decimal "1,5" */
export function parseUnitValue(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** business-hours are out of scope — targets are wall-clock like osTicket's default */
export function computeDueDates(
  target: SLATargetRow | null | undefined,
  from: Date
): { responseDueAt: Date | null; resolveDueAt: Date | null } {
  if (!target) return { responseDueAt: null, resolveDueAt: null }
  return {
    responseDueAt: target.ResponseMins > 0 ? new Date(from.getTime() + target.ResponseMins * 60000) : null,
    resolveDueAt: target.ResolveMins > 0 ? new Date(from.getTime() + target.ResolveMins * 60000) : null,
  }
}

export type SLAState = 'ON_TRACK' | 'DUE_SOON' | 'BREACHED' | 'MET' | 'MISSED' | 'NONE'

export interface SLAHealth {
  /** overall status to badge in lists */
  state: SLAState
  /** TTA health */
  response: SLAState
  /** TTR health */
  resolve: SLAState
  /** elapsed fraction (0..1+) of the TTR window — for progress bars */
  ttrElapsed: number
}

/**
 * Evaluate SLA health for a request.
 * `SubmittedAt` anchors both windows; the response window ends at RespondedAt (TTA),
 * the resolution window ends at ResolvedAt (TTR).
 */
export function slaHealth(req: {
  SubmittedAt: Date | string | null
  Priority: string
  ResponseDueAt: Date | string | null
  ResolveDueAt: Date | string | null
  RespondedAt: Date | string | null
  ResolvedAt: Date | string | null
}, now: Date = new Date()): SLAHealth {
  const d = (v: Date | string | null) => (v ? new Date(v) : null)
  const submitted = d(req.SubmittedAt)
  const respDue = d(req.ResponseDueAt)
  const resDue = d(req.ResolveDueAt)
  const responded = d(req.RespondedAt)
  const resolved = d(req.ResolvedAt)

  // TTA
  let response: SLAState = 'NONE'
  if (respDue) {
    if (responded) response = responded.getTime() <= respDue.getTime() ? 'MET' : 'MISSED'
    else response = now.getTime() > respDue.getTime() ? 'BREACHED' : 'ON_TRACK'
  }

  // TTR (with progress = elapsed fraction of the window)
  let resolve: SLAState = 'NONE'
  let ttrElapsed = 0
  if (resDue && submitted) {
    if (resolved) {
      resolve = resolved.getTime() <= resDue.getTime() ? 'MET' : 'MISSED'
      ttrElapsed = 1
    } else {
      const win = resDue.getTime() - submitted.getTime()
      ttrElapsed = win > 0 ? Math.min(Math.max((now.getTime() - submitted.getTime()) / win, 0), 1) : 0
      resolve = now.getTime() > resDue.getTime() ? 'BREACHED' : ttrElapsed >= 0.75 ? 'DUE_SOON' : 'ON_TRACK'
    }
  }

  // overall: once resolved, TTR verdict wins; live = worst active state
  const rank: Record<SLAState, number> = { BREACHED: 5, DUE_SOON: 3, ON_TRACK: 2, MISSED: 4, MET: 1, NONE: 0 }
  let state: SLAState = 'NONE'
  if (resolve !== 'NONE') {
    if (resolve === 'MET' || resolve === 'MISSED') state = resolve
    else if (rank[response] > rank[resolve] && response !== 'MET') state = response
    else state = resolve
  } else {
    state = response
  }
  return { state, response, resolve, ttrElapsed }
}

export const SLA_BADGE: Record<SLAState, { label: string; cls: string; icon: string }> = {
  ON_TRACK: { label: 'On track', cls: 'bg-tertiary-fixed text-green-800', icon: 'schedule' },
  DUE_SOON: { label: 'Due soon', cls: 'bg-amber-100 text-on-secondary-fixed-variant', icon: 'warning' },
  BREACHED: { label: 'SLA breached', cls: 'bg-error-container text-on-error-container', icon: 'alarm' },
  MET: { label: 'Met SLA', cls: 'bg-tertiary-fixed text-green-800', icon: 'check_circle' },
  MISSED: { label: 'Missed SLA', cls: 'bg-error-container text-on-error-container', icon: 'error' },
  NONE: { label: 'No SLA', cls: 'bg-surface-container text-outline', icon: 'remove' },
}

export function fmtMinutes(mins: number): string {
  if (mins % (24 * 60) === 0) {
    const d = mins / (24 * 60)
    return `${d}d`
  }
  if (mins % 60 === 0) return `${mins / 60}h`
  if (mins > 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return `${mins}m`
}

export function fmtDuration(fromMs: number, toMs: number): string {
  const mins = Math.max(0, Math.round((toMs - fromMs) / 60000))
  return fmtMinutes(mins)
}
