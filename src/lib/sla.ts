// SLA / OLA computation (GLPI-style TTA & TTR targets). Pure — no prisma, safe for client use.

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export type Priority = (typeof PRIORITIES)[number]

export interface SLATargetRow {
  Priority: string
  ResponseMins: number
  ResolveMins: number
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
  ON_TRACK: { label: 'On track', cls: 'bg-green-100 text-green-800', icon: 'schedule' },
  DUE_SOON: { label: 'Due soon', cls: 'bg-amber-100 text-amber-800', icon: 'warning' },
  BREACHED: { label: 'SLA breached', cls: 'bg-red-100 text-red-800', icon: 'alarm' },
  MET: { label: 'Met SLA', cls: 'bg-green-100 text-green-800', icon: 'check_circle' },
  MISSED: { label: 'Missed SLA', cls: 'bg-red-100 text-red-800', icon: 'error' },
  NONE: { label: 'No SLA', cls: 'bg-gray-100 text-gray-500', icon: 'remove' },
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
