import { NextRequest } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'

interface Params { params: { id: string } }

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const BLOCKED_EXT = new Set(
  ['exe', 'bat', 'cmd', 'com', 'sh', 'bash', 'ps1', 'vbs', 'vba', 'jar', 'msi', 'js', 'jse', 'wsf', 'html', 'htm', 'svg', 'swf']
)

export function uploadDir(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
}

function safeName(original: string): string {
  const base = path.basename(original).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
  return base.length > 0 ? base : 'file'
}

// GET /api/requests/[id]/attachments — list files
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const request = await prisma.requests.findUnique({
    where: { RequestID: params.id },
    select: { RequestID: true, RequesterID: true },
  })
  if (!request) return notFound('Request not found')
  if (request.RequesterID !== payload.userId && !hasPermission(ctx, 'REQUEST_VIEW_ALL')) {
    return forbidden()
  }

  const files = await prisma.requestAttachments.findMany({
    where: { RequestID: params.id },
    include: { Uploader: { select: { UserID: true, Name: true } } },
    orderBy: { CreatedAt: 'asc' },
  })
  return json(files)
}

// POST /api/requests/[id]/attachments — upload a file (multipart, field "file")
export async function POST(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const request = await prisma.requests.findUnique({
    where: { RequestID: params.id },
    select: { RequestID: true, RequesterID: true },
  })
  if (!request) return notFound('Request not found')

  const canUpload =
    request.RequesterID === payload.userId || hasPermission(ctx, 'REQUEST_VIEW_ALL')
  if (!canUpload) return forbidden()

  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return json({ error: 'Invalid multipart body' }, 400)
  }
  if (!file) return json({ error: 'file field required' }, 400)
  if (file.size === 0) return json({ error: 'Empty file' }, 400)
  if (file.size > MAX_SIZE) return json({ error: 'File exceeds 10 MB limit' }, 400)

  const original = safeName(file.name || 'file')
  const ext = original.includes('.') ? original.split('.').pop()!.toLowerCase() : ''
  if (ext && BLOCKED_EXT.has(ext)) {
    return json({ error: `Files of type .${ext} are not allowed` }, 400)
  }

  const dir = path.join(uploadDir(), 'requests', params.id)
  await fs.mkdir(dir, { recursive: true })
  const stored = `${randomUUID()}_${original}`
  const fullPath = path.join(dir, stored)
  const buf = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(fullPath, buf)

  const row = await prisma.requestAttachments.create({
    data: {
      RequestID: params.id,
      UploadedByUserID: payload.userId,
      FileName: original,
      FilePath: path.join('requests', params.id, stored),
      MimeType: file.type || 'application/octet-stream',
      FileSize: BigInt(file.size),
    },
    include: { Uploader: { select: { UserID: true, Name: true } } },
  })

  await prisma.requestAuditLog.create({
    data: {
      RequestID: params.id,
      FromStatus: null,
      ToStatus: null,
      Action: 'ATTACH',
      Note: original,
      ChangedByUserID: payload.userId,
    },
  })

  return json({ ...row, FileSize: row.FileSize.toString() }, 201)
}
