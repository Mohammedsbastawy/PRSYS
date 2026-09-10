import { NextRequest } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { parseAcceptList, parseFieldConfig } from '@/lib/field-config'
import { syncFieldAttachmentsValue, uploadDir } from '@/lib/request-attachments'

interface Params { params: { id: string } }

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const BLOCKED_EXT = new Set(
  ['exe', 'bat', 'cmd', 'com', 'sh', 'bash', 'ps1', 'vbs', 'vba', 'jar', 'msi', 'js', 'jse', 'wsf', 'html', 'htm', 'svg', 'swf']
)

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
  // BigInt is not JSON-serializable — stringify file sizes
  return json(files.map((f: { FileSize: bigint }) => ({ ...f, FileSize: f.FileSize.toString() })))
}

// POST /api/requests/[id]/attachments — upload a file (multipart: "file", optional "formFieldId")
export async function POST(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const request = await prisma.requests.findUnique({
    where: { RequestID: params.id },
    select: { RequestID: true, RequesterID: true, FormTemplateID: true },
  })
  if (!request) return notFound('Request not found')

  const canUpload =
    request.RequesterID === payload.userId || hasPermission(ctx, 'REQUEST_VIEW_ALL')
  if (!canUpload) return forbidden()

  let file: File | null = null
  let formFieldId: string | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
    const ff = form.get('formFieldId')
    if (typeof ff === 'string' && ff.trim() !== '') formFieldId = ff.trim()
  } catch {
    return json({ error: 'Invalid multipart body' }, 400)
  }
  if (!file) return json({ error: 'file field required' }, 400)

  // field-bound upload: the field must be a file field of this request's template
  let maxFiles = 0
  let sizeLimit = MAX_SIZE
  let sizeLabel = '10 MB'
  let accept: string[] = []
  let fieldLabel = ''
  if (formFieldId) {
    const field = await prisma.formFields.findUnique({
      where: { FormFieldID: formFieldId },
      select: { FormFieldID: true, FormTemplateID: true, FieldType: true, Label: true, Config: true },
    })
    if (!field || field.FormTemplateID !== request.FormTemplateID || field.FieldType !== 'file') {
      return json({ error: 'Invalid form field for upload' }, 400)
    }
    const cfg = parseFieldConfig(field.Config)
    maxFiles = cfg.maxFiles.trim() === '' ? 5 : Math.max(1, parseInt(cfg.maxFiles, 10) || 5)
    const maxMB = cfg.maxSizeMB.trim() === '' ? 10 : Math.max(1, parseFloat(cfg.maxSizeMB) || 10)
    sizeLimit = Math.min(MAX_SIZE, Math.floor(maxMB * 1024 * 1024))
    sizeLabel = `${maxMB} MB`
    accept = parseAcceptList(cfg.accept)
    fieldLabel = field.Label
    const current = await prisma.requestAttachments.count({
      where: { RequestID: params.id, FormFieldID: formFieldId },
    })
    if (current >= maxFiles) {
      return json({ error: `"${fieldLabel}" allows at most ${maxFiles} file(s)` }, 400)
    }
  }

  if (file.size === 0) return json({ error: 'Empty file' }, 400)
  if (file.size > sizeLimit) return json({ error: `File exceeds ${sizeLabel} limit` }, 400)

  const original = safeName(file.name || 'file')
  const ext = original.includes('.') ? original.split('.').pop()!.toLowerCase() : ''
  if (ext && BLOCKED_EXT.has(ext)) {
    return json({ error: `Files of type .${ext} are not allowed` }, 400)
  }
  if (formFieldId && accept.length > 0 && !accept.includes(ext)) {
    return json({ error: `"${fieldLabel}" only accepts ${accept.map((a) => `.${a}`).join(', ')} files` }, 400)
  }

  const dir = path.join(uploadDir(), 'requests', params.id)
  await fs.mkdir(dir, { recursive: true })
  const stored = `${randomUUID()}_${original}`
  const fullPath = path.join(dir, stored)
  const buf = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(fullPath, buf)

  let row
  try {
    row = await prisma.requestAttachments.create({
      data: {
        RequestID: params.id,
        UploadedByUserID: payload.userId,
        FormFieldID: formFieldId,
        FileName: original,
        FilePath: path.join('requests', params.id, stored),
        MimeType: file.type || 'application/octet-stream',
        FileSize: BigInt(file.size),
      },
      include: { Uploader: { select: { UserID: true, Name: true } } },
    })
    if (formFieldId) {
      await syncFieldAttachmentsValue(params.id, formFieldId)
    }
  } catch (e) {
    // roll back the stored file + row so a failed upload leaves nothing behind
    try {
      await fs.unlink(fullPath)
    } catch {
      /* ignore */
    }
    console.error('attachment upload failed:', e)
    return json({ error: 'Upload failed — please retry' }, 500)
  }

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
