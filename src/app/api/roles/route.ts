import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'

// GET /api/roles — list roles with their permissions
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'ROLE_MANAGE')) return json([]) // non-admins get empty

  const roles = await prisma.roles.findMany({
    include: {
      RolePermissions: { include: { Permission: true } },
    },
    orderBy: { Name: 'asc' },
  })
  return json(
    roles.map((r) => ({
      id: r.RoleID,
      code: r.Code,
      name: r.Name,
      description: r.Description,
      isSystemDefault: r.IsSystemDefault,
      permissions: r.RolePermissions.map((rp) => ({
        code: rp.Permission.Code,
        module: rp.Permission.Module,
        name: rp.Permission.Name,
      })),
    }))
  )
}
