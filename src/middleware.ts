import { NextRequest, NextResponse } from 'next/server'

// Routes that don't require auth
const PUBLIC_ROUTES = ['/api/auth/login', '/api/health']

// Lightweight token check in middleware (full RBAC happens in routes)
function extractToken(req: NextRequest): string | null {
  const h = req.headers.get('authorization')
  if (h?.startsWith('Bearer ')) return h.slice(7)
  return null
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.next()
  }

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const token = extractToken(req)
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Forward token to downstream routes via header (routes verify + decode)
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-auth-token', token)

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/api/:path*'],
}
