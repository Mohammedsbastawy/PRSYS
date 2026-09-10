import { prisma } from './prisma'

/**
 * Can this user see/use a form template?
 * Rule: no FormPermissions rows with PermissionType='VIEW' → the form is Public.
 * Otherwise the user must match directly (UserID), via their department
 * (Users.DEPID), or via one of their groups (GroupMembers).
 */
export async function canUserUseTemplate(userId: string, templateId: string): Promise<boolean> {
  const rows = await prisma.formPermissions.findMany({
    where: { FormTemplateID: templateId, PermissionType: 'VIEW' },
    select: { DEPID: true, GroupID: true, UserID: true },
  })
  if (rows.length === 0) return true

  // direct user grant
  if (rows.some((r) => r.UserID === userId)) return true

  // department grant
  const user = await prisma.users.findUnique({
    where: { UserID: userId },
    select: { DEPID: true },
  })
  if (user?.DEPID && rows.some((r) => r.DEPID === user.DEPID)) return true

  // group grant
  const memberships = await prisma.groupMembers.findMany({
    where: { UserID: userId },
    select: { GroupID: true },
  })
  const gids = new Set(memberships.map((m) => m.GroupID))
  if (rows.some((r) => r.GroupID && gids.has(r.GroupID))) return true

  return false
}
