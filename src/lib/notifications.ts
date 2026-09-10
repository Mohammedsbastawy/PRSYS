import { prisma } from './prisma'

export interface NotifyInput {
  title: string
  message: string
  type: string
  requestId?: string | null
}

/** Create notifications for users. Never throws — failures are logged only. */
export async function notifyUsers(userIds: string[], n: NotifyInput): Promise<void> {
  try {
    const unique = Array.from(new Set(userIds.filter(Boolean)))
    if (unique.length === 0) return
    await prisma.notifications.createMany({
      data: unique.map((uid) => ({
        UserID: uid,
        Title: n.title,
        Message: n.message,
        Type: n.type,
        RelatedRequestID: n.requestId ?? null,
      })),
    })
  } catch (e) {
    console.error('notifyUsers failed:', e)
  }
}

/** Active users holding a given permission (used for queue alerts). */
export async function usersWithPermission(permissionCode: string): Promise<string[]> {
  try {
    const users = await prisma.users.findMany({
      where: {
        IsActive: true,
        Role: { RolePermissions: { some: { Permission: { Code: permissionCode } } } },
      },
      select: { UserID: true },
    })
    return users.map((u) => u.UserID)
  } catch (e) {
    console.error('usersWithPermission failed:', e)
    return []
  }
}
