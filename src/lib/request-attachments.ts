import path from 'path'
import { prisma } from './prisma'

/** Shared attachments helpers (kept out of route files — Next routes may only export handlers). */

export function uploadDir(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
}

/**
 * Recompute a file-field's answer (JSON array of attachment IDs) from the
 * current attachment rows. Throws on failure — callers decide how to handle.
 */
export async function syncFieldAttachmentsValue(requestId: string, formFieldId: string): Promise<void> {
  const rows = await prisma.requestAttachments.findMany({
    where: { RequestID: requestId, FormFieldID: formFieldId },
    select: { RequestAttachmentID: true },
    orderBy: { CreatedAt: 'asc' },
  })
  const value = JSON.stringify(
    rows.map((r: { RequestAttachmentID: string }) => r.RequestAttachmentID)
  )
  const existing = await prisma.requestFieldValues.findFirst({
    where: { RequestID: requestId, FormFieldID: formFieldId },
    select: { RequestFieldValueID: true },
  })
  if (existing) {
    await prisma.requestFieldValues.update({
      where: { RequestFieldValueID: existing.RequestFieldValueID },
      data: { Value: value },
    })
  } else {
    await prisma.requestFieldValues.create({
      data: { RequestID: requestId, FormFieldID: formFieldId, Value: value },
    })
  }
}
