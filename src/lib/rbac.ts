import { prisma } from './prisma'
import type { JwtPayload } from './auth'

export interface UserContext {
  userId: string
  roleId: string
  roleCode: string
  permissions: Set<string>
  depId: string | null
}

let cache: Map<string, Set<string>> = new Map()

export async function getUserContext(userId: string): Promise<UserContext | null> {
  const user = await prisma.users.findUnique({
    where: { UserID: userId },
    include: {
      Role: {
        include: {
          RolePermissions: { include: { Permission: true } },
        },
      },
    },
  })
  if (!user) return null
  const perms = new Set<string>()
  user.Role.RolePermissions.forEach((rp) => perms.add(rp.Permission.Code))
  return {
    userId: user.UserID,
    roleId: user.RoleID,
    roleCode: user.Role.Code,
    permissions: perms,
    depId: user.DEPID,
  }
}

export function hasPermission(ctx: UserContext, code: string): boolean {
  return ctx.permissions.has(code) || ctx.roleCode === 'SUPER_ADMIN'
}

export function requirePermission(ctx: UserContext, code: string): boolean {
  return hasPermission(ctx, code)
}
