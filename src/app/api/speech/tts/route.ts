import { NextResponse } from 'next/server'
import { checkRateLimit, RATE_LIMITS } from '@/server/ratelimit'
import { getSession } from '@/server/session'
import { isElevenLabsConfigured, synthesizeSpeech } from '@/server/speech/elevenlabs'

export const dynamic = 'force-dynamic'

/**
 * Text-to-speech proxy.
 *
 * The browser sends text and gets audio back; the ElevenLabs key stays here and
 * never reaches the client. Ownership comes from the session, never the client,
 * and the transcript-in / audio-out shape means no audio is ever persisted.
 */
export async function POST(request: Request): Promise<Response> {
  const { userId } = await getSession()

  if (!isElevenLabsConfigured()) {
    // Not an error the user can fix from here — the client falls back to browser
    // speech when this route is unavailable.
    return NextResponse.json({ error: 'Hosted speech is not configured.' }, { status: 501 })
  }

  const limit = checkRateLimit(`${userId}:tts`, RATE_LIMITS.speech)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too much speech at once. Try again shortly.' },
      { status: 429, headers: { 'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)) } },
    )
  }

  let text: unknown
  try {
    text = (await request.json())?.text
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "text" field.' }, { status: 400 })
  }

  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'Nothing to speak.' }, { status: 400 })
  }
  // A hard ceiling so a runaway reply cannot bill an enormous synthesis.
  if (text.length > 5000) {
    return NextResponse.json({ error: 'That is too long to read aloud.' }, { status: 413 })
  }

  try {
    const { audio, contentType } = await synthesizeSpeech(text)
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Could not read that aloud right now.' }, { status: 502 })
  }
}
