import { NextResponse } from 'next/server'
import type { ZodSchema } from 'zod'

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 })
}

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    const body = await req.json()
    const result = schema.safeParse(body)
    if (!result.success) {
      const msg = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(', ')
      return { data: null, error: msg }
    }
    return { data: result.data, error: null }
  } catch {
    return { data: null, error: 'Invalid JSON body' }
  }
}
