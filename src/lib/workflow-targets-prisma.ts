import { prisma } from './prisma'
import { usersWithPermission } from './notifications'
import type { StepLookups } from './workflow-targets'

/**
 * Prisma-backed lookups for workflow step-target resolution.
 * Shared by the requests and approvals APIs.
 */
export function stepLookups(): StepLookups {
  return {
    usersWithRole: async (roleId) => {
      const rows = await prisma.users.findMany({
        where: { RoleID: roleId, IsActive: true },
        select: { UserID: true },
      })
      return rows.map((r) => r.UserID)
    },
    groupMembers: async (groupId) => {
      const rows = await prisma.groupMembers.findMany({
        where: { GroupID: groupId },
        select: { UserID: true },
      })
      return rows.map((r) => r.UserID)
    },
    requesterManager: async (requesterId) => {
      const u = await prisma.users.findUnique({
        where: { UserID: requesterId },
        select: { DirectManagerID: true },
      })
      return u?.DirectManagerID ?? null
    },
    departmentManager: async (requesterId) => {
      // Users.DEPID is a plain scalar (no FK relation) — resolve in two steps
      const u = await prisma.users.findUnique({
        where: { UserID: requesterId },
        select: { DEPID: true },
      })
      if (!u?.DEPID) return null
      const dep = await prisma.dEP.findUnique({
        where: { DEPID: u.DEPID },
        select: { ManagerID: true },
      })
      return dep?.ManagerID ?? null
    },
    allApprovers: () => usersWithPermission('REQUEST_APPROVE'),
  }
}

/** Departments managed by a user (assignment-based, not role-based). */
export async function managedDepIds(userId: string): Promise<string[]> {
  const rows = await prisma.dEP.findMany({
    where: { ManagerID: userId },
    select: { DEPID: true },
  })
  return rows.map((d) => d.DEPID)
}
