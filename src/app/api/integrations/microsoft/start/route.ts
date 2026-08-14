import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { checkMicrosoftEnv } from '@/server/env'
import { authorizeUrl, createPkcePair, createState } from '@/server/integrations/microsoft'
import { checkRateLimit, RATE_LIMITS } from '@/server/ratelimit'
import { getSession } from '@/server/session'

export const dynamic = 'force-dynamic'

export const OAUTH_STATE_COOKIE = 'momentum_ms_state'
export const OAUTH_VERIFIER_COOKIE = 'momentum_ms_verifier'

/**
 * Begins the Microsoft connection.
 *
 * The PKCE verifier and CSRF state are stored in httpOnly, SameSite=Lax
 * cookies: Lax rather than Strict because the browser arrives here from
 * Microsoft's domain and a Strict cookie would not be sent back on that
 * navigation.
 *
 * They are deliberately short-lived — an abandoned connection attempt should
 * not leave a usable verifier sitting in the browser for the rest of the day.
 */
export async function GET(): Promise<Response> {
  const { userId } = await getSession()

  const limit = checkRateLimit(`${userId}:oauth-start`, RATE_LIMITS.send)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many connection attempts. Try again shortly.' },
      { status: 429 },
    )
  }

  const env = checkMicrosoftEnv()
  if (!env.ok || !env.value) {
    // Fail here, with specifics, rather than bouncing the user to a generic
    // Microsoft error page.
    return NextResponse.json(
      {
        error: 'The Microsoft integration is not fully configured.',
        problems: env.problems,
      },
      { status: 400 },
    )
  }

  const state = createState()
  const { verifier, challenge } = createPkcePair()

  const jar = await cookies()
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600, // ten minutes is ample for a consent screen
  }

  jar.set(OAUTH_STATE_COOKIE, state, cookieOptions)
  jar.set(OAUTH_VERIFIER_COOKIE, verifier, cookieOptions)

  return NextResponse.redirect(authorizeUrl(env.value, state, challenge))
}
