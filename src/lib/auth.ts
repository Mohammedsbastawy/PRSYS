import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { NextRequest } from 'next/server'

const JWT_SECRET = process.env.JWT_SECRET || 'prsys-dev-secret-change-me'
const JWT_EXPIRES_IN = '12h'

export interface JwtPayload {
  userId: string
  email: string
  roleId: string
  roleCode: string
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch {
    return null
  }
}

export function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization')
  if (auth && auth.startsWith('Bearer ')) {
    return auth.substring(7)
  }
  // also check cookie
  const cookie = req.cookies.get('prsys_token')?.value
  return cookie || null
}

export function getUserFromRequest(req: NextRequest): JwtPayload | null {
  const token = extractToken(req)
  if (!token) return null
  return verifyToken(token)
}
