import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'connected', time: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json({ status: 'error', db: 'disconnected', message: String(e) }, { status: 500 })
  }
}
