import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyPassword, signToken } from '@/lib/auth'
import { getUserContext } from '@/lib/rbac'
import { json, error, parseBody } from '@/lib/http'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const { data, error: err } = await parseBody(req, loginSchema)
  if (err) return error(err)

  const user = await prisma.users.findUnique({
    where: { Email: data!.email },
    include: { Role: true, ManagedDEP: true },
  })

  if (!user || !user.PasswordHash) {
    return error('Invalid credentials', 401)
  }

  const ok = await verifyPassword(data!.password, user.PasswordHash)
  if (!ok) {
    return error('Invalid credentials', 401)
  }

  if (!user.IsActive) {
    return error('Account is disabled', 403)
  }

  const token = signToken({
    userId: user.UserID,
    email: user.Email,
    roleId: user.RoleID,
    roleCode: user.Role.Code,
  })

  // NOTE: `permissions` must be present here — the client-side RBAC guards
  // (user?.permissions?.includes(...)) hydrate from the login response, so a
  // payload without it shows "No permission" screens until the user reloads.
  const ctx = await getUserContext(user.UserID)

  return json({
    token,
    user: {
      id: user.UserID,
      name: user.Name,
      email: user.Email,
      role: { id: user.RoleID, code: user.Role.Code, name: user.Role.Name },
      department: user.ManagedDEP ? { id: user.ManagedDEP.DEPID, name: user.ManagedDEP.Name } : null,
      accountType: user.AccountType,
      permissions: ctx ? Array.from(ctx.permissions) : [],
    },
  })
}
