import { NextResponse } from 'next/server'
import { checkRateLimit, RATE_LIMITS } from '@/server/ratelimit'
import { getSession } from '@/server/session'
import { isDeepgramConfigured, transcribeAudio } from '@/server/speech/deepgram'

export const dynamic = 'force-dynamic'

// One utterance of speech is small; this ceiling only stops a pathological clip.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/**
 * Speech-to-text proxy.
 *
 * The browser records one clip and posts the raw bytes here; the Deepgram key
 * stays on the server. Only the text transcript is returned — the audio is
 * transcribed and dropped, never stored.
 */
export async function POST(request: Request): Promise<Response> {
  const { userId } = await getSession()

  if (!isDeepgramConfigured()) {
    return NextResponse.json({ error: 'Hosted transcription is not configured.' }, { status: 501 })
  }

  const limit = checkRateLimit(`${userId}:stt`, RATE_LIMITS.speech)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too much at once. Try again shortly.' },
      { status: 429, headers: { 'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)) } },
    )
  }

  const contentType = request.headers.get('content-type') ?? 'audio/webm'
  const buffer = await request.arrayBuffer()

  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: 'No audio was received.' }, { status: 400 })
  }
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'That recording is too large.' }, { status: 413 })
  }

  try {
    const { transcript } = await transcribeAudio(new Uint8Array(buffer), { contentType })
    return NextResponse.json({ transcript }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Could not transcribe that right now.' }, { status: 502 })
  }
}
