import { NextRequest } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { uploadDir } from '../../attachments/route'

interface Params { params: { id: string; attId: string } }

async function loadAttachment(attId: string, requestId: string) {
  const att = await prisma.requestAttachments.findFirst({
    where: { RequestAttachmentID: attId, RequestID: requestId },
    include: { Request: { select: { RequesterID: true } } },
  })
  return att
}

// GET /api/requests/[id]/attachments/[attId] — download file
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const att = await loadAttachment(params.attId, params.id)
  if (!att) return notFound('Attachment not found')
  if (att.Request.RequesterID !== payload.userId && !hasPermission(ctx, 'REQUEST_VIEW_ALL')) {
    return forbidden()
  }

  const fullPath = path.join(uploadDir(), att.FilePath)
  let data: Buffer
  try {
    data = await fs.readFile(fullPath)
  } catch {
    return notFound('File missing on disk')
  }

  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': att.MimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.FileName)}`,
      'Content-Length': String(data.length),
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// DELETE /api/requests/[id]/attachments/[attId] — remove file (uploader or admin)
export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const att = await prisma.requestAttachments.findFirst({
    where: { RequestAttachmentID: params.attId, RequestID: params.id },
  })
  if (!att) return notFound('Attachment not found')
  if (att.UploadedByUserID !== payload.userId && ctx.roleCode !== 'SUPER_ADMIN') {
    return forbidden()
  }

  await prisma.requestAttachments.delete({ where: { RequestAttachmentID: params.attId } })
  try {
    await fs.unlink(path.join(uploadDir(), att.FilePath))
  } catch {
    /* already gone */
  }
  await prisma.requestAuditLog.create({
    data: {
      RequestID: params.id,
      Action: 'DETACH',
      Note: att.FileName,
      ChangedByUserID: payload.userId,
    },
  })
  return json({ ok: true })
}
