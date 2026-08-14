import { z } from 'zod'
import type { EnvCheck, EnvSource } from '@/server/env'

/**
 * ElevenLabs text-to-speech.
 *
 * Kept as a small, injectable function rather than an SDK: one REST call, and
 * `fetch` is passed in so the behaviour — including the failure paths — is unit
 * testable without a network or a real key. The key never leaves the server;
 * the browser adapter talks to `/api/speech/tts`, not to ElevenLabs directly.
 */

const schema = z.object({
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_VOICE_ID: z.string().min(1),
  ELEVENLABS_MODEL_ID: z.string().min(1).optional(),
})

export type ElevenLabsEnv = z.infer<typeof schema>

const FIX_HINTS: Record<string, string> = {
  ELEVENLABS_API_KEY: 'An API key from elevenlabs.io → Profile → API Keys.',
  ELEVENLABS_VOICE_ID: 'A voice id from elevenlabs.io → Voices (the id, not the name).',
}

export function checkElevenLabsEnv(source: EnvSource = process.env): EnvCheck<ElevenLabsEnv> {
  const result = schema.safeParse(source)
  if (result.success) return { ok: true, value: result.data, problems: [] }

  const problems = result.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? 'configuration')
    const hint = FIX_HINTS[key]
    return hint ? `${key} is not set. ${hint}` : `${key} is not set.`
  })
  return { ok: false, problems }
}

export function isElevenLabsConfigured(source: EnvSource = process.env): boolean {
  return checkElevenLabsEnv(source).ok
}

export interface SynthesizeDeps {
  fetch?: typeof fetch
  env?: EnvSource
}

export interface SynthesizedSpeech {
  audio: ArrayBuffer
  contentType: string
}

// A default so replies do not read as a monotone robot. Overridable per env.
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5'

/**
 * Turns text into spoken audio. Rejects (never returns a bad buffer) on an
 * empty request, a missing configuration, or a provider error — and its error
 * messages are safe to surface: they never include the API key.
 */
export async function synthesizeSpeech(
  text: string,
  deps: SynthesizeDeps = {},
): Promise<SynthesizedSpeech> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Nothing to speak.')

  const check = checkElevenLabsEnv(deps.env ?? process.env)
  if (!check.ok || !check.value) {
    throw new Error('ElevenLabs is not configured for speech.')
  }
  const env = check.value
  const doFetch = deps.fetch ?? fetch

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    env.ELEVENLABS_VOICE_ID,
  )}?output_format=mp3_44100_128`

  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: trimmed,
        model_id: env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    })
  } catch {
    throw new Error('Could not reach the ElevenLabs speech service.')
  }

  if (!response.ok) {
    // Deliberately does not echo the response body: it can contain the request,
    // and never the key, but keeping the surface minimal is the safe default.
    throw new Error(`ElevenLabs speech synthesis failed (${response.status}).`)
  }

  const audio = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') ?? 'audio/mpeg'
  return { audio, contentType }
}
