import { prisma } from './prisma'
import type { UserContext } from './rbac'

/**
 * Form-visibility (= "who may see & request this form") enforcement.
 *
 * Contract (read-time, so newly-granted users instantly see older data again):
 * - A form with NO VIEW permissions rows is public.
 * - Otherwise only explicitly granted targets see it: whole departments,
 *   specific groups and/or individual users; PLUS the form owner
 *   (its OwnerDEP members / OwnerGroup members) and the Super Admin.
 * - The same rule gates the fill page, the template list, the requests list,
 *   the request detail, the approvals queue AND notifications tied to
 *   requests of that form. A requester always keeps access to their own
 *   requests (they created them through the form).
 */

export interface ViewerScope {
  userId: string
  depId: string | null
  groupIds: string[]
}

/** Load the viewer's department + group memberships once (for list filters). */
export async function viewerScope(userId: string): Promise<ViewerScope> {
  const [me, ms] = await Promise.all([
    prisma.users.findUnique({ where: { UserID: userId }, select: { DEPID: true } }),
    prisma.groupMembers.findMany({ where: { UserID: userId }, select: { GroupID: true } }),
  ])
  return { userId, depId: me?.DEPID ?? null, groupIds: ms.map((m) => m.GroupID) }
}

/** Super Admins see everything, always. */
export function visibilityBypass(ctx: UserContext): boolean {
  return ctx.roleCode === 'SUPER_ADMIN'
}

/**
 * Prisma `where` fragment for FormTemplates — the read-time ACL:
 * public forms OR granted targets OR the form owner.
 */
export function templateVisibilityWhere(s: ViewerScope): Record<string, unknown> {
  const grantedOr: Record<string, unknown>[] = [{ UserID: s.userId }]
  if (s.depId) grantedOr.push({ DEPID: s.depId })
  if (s.groupIds.length > 0) grantedOr.push({ GroupID: { in: s.groupIds } })
  const or: Record<string, unknown>[] = [
    { FormPerms: { none: { PermissionType: 'VIEW' } } },
    { FormPerms: { some: { PermissionType: 'VIEW', OR: grantedOr } } },
  ]
  if (s.depId) or.push({ OwnerDEPID: s.depId })
  if (s.groupIds.length > 0) or.push({ OwnerGroupID: { in: s.groupIds } })
  return { OR: or }
}

/** Prisma `where` fragment for Requests — same ACL applied through the form. */
export function requestVisibilityWhere(s: ViewerScope): Record<string, unknown> {
  return { OR: [{ RequesterID: s.userId }, { FormTemplate: { is: templateVisibilityWhere(s) } }] }
}

/**
 * Can this user see/use a form template?
 * Rule: no VIEW rows → public. Otherwise direct / department / group grant —
 * or the user belongs to the template owner (OwnerDEP / OwnerGroup).
 */
export async function canUserUseTemplate(userId: string, templateId: string): Promise<boolean> {
  const [tmpl, rows, me, ms] = await Promise.all([
    prisma.formTemplates.findUnique({
      where: { FormTemplateID: templateId },
      select: { OwnerDEPID: true, OwnerGroupID: true },
    }),
    prisma.formPermissions.findMany({
      where: { FormTemplateID: templateId, PermissionType: 'VIEW' },
      select: { DEPID: true, GroupID: true, UserID: true },
    }),
    prisma.users.findUnique({ where: { UserID: userId }, select: { DEPID: true } }),
    prisma.groupMembers.findMany({ where: { UserID: userId }, select: { GroupID: true } }),
  ])
  if (!tmpl) return false
  // form owner always sees it
  if (tmpl.OwnerDEPID && me?.DEPID === tmpl.OwnerDEPID) return true
  if (tmpl.OwnerGroupID && ms.some((m) => m.GroupID === tmpl.OwnerGroupID)) return true
  // public form
  if (rows.length === 0) return true
  // grants
  if (rows.some((r) => r.UserID === userId)) return true
  if (me?.DEPID && rows.some((r) => r.DEPID === me.DEPID)) return true
  const gids = new Set(ms.map((m) => m.GroupID))
  if (rows.some((r) => r.GroupID && gids.has(r.GroupID))) return true
  return false
}

/**
 * From a list of candidate recipient ids, keep only the ones who may see
 * this form (used before raising notifications so restricted forms never
 * leak into unpermitted users' inboxes). Super Admins pass.
 */
export async function filterVisibleUserIds(userIds: string[], templateId: string): Promise<string[]> {
  const unique = Array.from(new Set(userIds))
  if (unique.length === 0) return []
  const [rows, users, ms] = await Promise.all([
    prisma.formPermissions.findMany({
      where: { FormTemplateID: templateId, PermissionType: 'VIEW' },
      select: { DEPID: true, GroupID: true, UserID: true },
    }),
    prisma.users.findMany({
      where: { UserID: { in: unique } },
      select: { UserID: true, DEPID: true, Role: { select: { Code: true } } },
    }),
    prisma.groupMembers.findMany({
      where: { UserID: { in: unique } },
      select: { UserID: true, GroupID: true },
    }),
  ])
  const byGroup = new Map<string, string[]>()
  for (const m of ms) {
    byGroup.set(m.UserID, [...(byGroup.get(m.UserID) ?? []), m.GroupID])
  }
  return users
    .filter((u) => {
      if (u.Role.Code === 'SUPER_ADMIN') return true
      if (rows.length === 0) return true
      if (rows.some((r) => r.UserID === u.UserID)) return true
      if (u.DEPID && rows.some((r) => r.DEPID === u.DEPID)) return true
      const gids = byGroup.get(u.UserID) ?? []
      return rows.some((r) => r.GroupID && gids.includes(r.GroupID))
    })
    .map((u) => u.UserID)
}
