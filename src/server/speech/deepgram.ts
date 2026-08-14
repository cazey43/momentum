import { z } from 'zod'
import type { EnvCheck, EnvSource } from '@/server/env'

/**
 * Deepgram speech-to-text (prerecorded).
 *
 * A single utterance is recorded in the browser and posted here as one clip,
 * rather than streamed: it is far simpler and more robust than a WebSocket relay
 * on the App Router, and push-to-talk already has a clear end (the user stops).
 * The key stays on the server; the browser talks to `/api/speech/stt`.
 *
 * `fetch` and the audio are injected so the parsing and failure paths are unit
 * testable without a network. No audio is stored: it is transcribed and dropped.
 */

const schema = z.object({
  DEEPGRAM_API_KEY: z.string().min(1),
})

export type DeepgramEnv = z.infer<typeof schema>

export function checkDeepgramEnv(source: EnvSource = process.env): EnvCheck<DeepgramEnv> {
  const result = schema.safeParse(source)
  if (result.success) return { ok: true, value: result.data, problems: [] }
  return {
    ok: false,
    problems: ['DEEPGRAM_API_KEY is not set. An API key from console.deepgram.com → API Keys.'],
  }
}

export function isDeepgramConfigured(source: EnvSource = process.env): boolean {
  return checkDeepgramEnv(source).ok
}

export interface TranscribeDeps {
  fetch?: typeof fetch
  env?: EnvSource
  /** MIME type of the recorded clip, e.g. audio/webm. */
  contentType?: string
}

export interface Transcription {
  transcript: string
}

const deepgramResult = z.object({
  results: z.object({
    channels: z
      .array(z.object({ alternatives: z.array(z.object({ transcript: z.string() })) }))
      .optional(),
  }),
})

/**
 * Transcribes a single audio clip. Rejects on empty audio, missing
 * configuration, or a provider error; a recognised-but-silent clip resolves to
 * an empty transcript rather than throwing. Errors never include the API key.
 */
export async function transcribeAudio(
  audio: ArrayBuffer | Uint8Array,
  deps: TranscribeDeps = {},
): Promise<Transcription> {
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio)
  if (bytes.byteLength === 0) throw new Error('No audio to transcribe.')

  const check = checkDeepgramEnv(deps.env ?? process.env)
  if (!check.ok || !check.value) {
    throw new Error('Deepgram is not configured for transcription.')
  }
  const env = check.value
  const doFetch = deps.fetch ?? fetch

  const url = 'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true'

  // Copy into a plain ArrayBuffer: a Uint8Array view is a valid fetch body at
  // runtime, but the DOM `BodyInit` type no longer accepts the generic typed
  // array, and an exact-length buffer is unambiguous.
  const body = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(body).set(bytes)

  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
        'content-type': deps.contentType ?? 'audio/webm',
      },
      body,
    })
  } catch {
    throw new Error('Could not reach the Deepgram transcription service.')
  }

  if (!response.ok) {
    throw new Error(`Deepgram transcription failed (${response.status}).`)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new Error('Deepgram returned an unreadable response.')
  }

  const parsed = deepgramResult.safeParse(json)
  const transcript =
    parsed.success && parsed.data.results.channels?.[0]?.alternatives?.[0]?.transcript
      ? parsed.data.results.channels[0].alternatives[0].transcript
      : ''

  return { transcript: transcript.trim() }
}
