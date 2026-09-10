import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

interface Params { params: { id: string } }

// GET /api/form-templates/[id]
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()

  const tmpl = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: params.id },
    include: {
      Category: true,
      Workflow: { include: { Steps: { orderBy: { StepOrder: 'asc' } } } },
      Fields: { orderBy: { SortOrder: 'asc' } },
    },
  })
  if (!tmpl) return notFound('Template not found')
  return json(tmpl)
}

const publishSchema = z.object({ status: z.string() })

// PATCH /api/form-templates/[id] — publish/activate
export async function PATCH(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, publishSchema)
  if (err) return json({ error: err }, 400)

  const tmpl = await prisma.formTemplates.update({
    where: { FormTemplateID: params.id },
    data: { Status: data!.status },
    select: { FormTemplateID: true, Status: true },
  })
  return json(tmpl)
}
