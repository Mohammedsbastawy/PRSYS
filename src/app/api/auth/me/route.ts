import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized } from '@/lib/http'
import { getUserContext } from '@/lib/rbac'

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()

  const user = await prisma.users.findUnique({
    where: { UserID: payload.userId },
    include: { Role: { include: { RolePermissions: { include: { Permission: true } } } }, ManagedDEP: true },
  })

  if (!user) return unauthorized()

  const ctx = await getUserContext(user.UserID)

  return json({
    id: user.UserID,
    name: user.Name,
    email: user.Email,
    accountType: user.AccountType,
    role: { id: user.RoleID, code: user.Role.Code, name: user.Role.Name },
    department: user.ManagedDEP ? { id: user.ManagedDEP.DEPID, name: user.ManagedDEP.Name } : null,
    permissions: ctx ? Array.from(ctx.permissions) : [],
  })
}
