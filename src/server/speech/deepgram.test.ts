import { describe, expect, it, vi } from 'vitest'
import { checkDeepgramEnv, isDeepgramConfigured, transcribeAudio } from './deepgram'

const ENV = { DEEPGRAM_API_KEY: 'dg-secret-key' }

function deepgramResponse(transcript: string) {
  return new Response(
    JSON.stringify({
      results: { channels: [{ alternatives: [{ transcript, confidence: 0.98 }] }] },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('checkDeepgramEnv', () => {
  it('is ok when the key is present', () => {
    expect(checkDeepgramEnv(ENV).ok).toBe(true)
  })

  it('reports the missing key with a fix hint', () => {
    const result = checkDeepgramEnv({})
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('DEEPGRAM_API_KEY')
  })

  it('isDeepgramConfigured mirrors the check', () => {
    expect(isDeepgramConfigured(ENV)).toBe(true)
    expect(isDeepgramConfigured({})).toBe(false)
  })
})

describe('transcribeAudio', () => {
  it('refuses empty audio without calling the network', async () => {
    const fetchImpl = vi.fn()
    await expect(
      transcribeAudio(new Uint8Array([]), { env: ENV, fetch: fetchImpl }),
    ).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts the audio with a Token header and returns the transcript', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(deepgramResponse('Send the contract to Dana'))

    const result = await transcribeAudio(new Uint8Array([1, 2, 3, 4]), {
      env: ENV,
      fetch: fetchImpl,
      contentType: 'audio/webm',
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const call = fetchImpl.mock.calls[0]
    expect(call).toBeDefined()
    const [url, init] = call as [string, { method: string; headers: Record<string, string> }]
    expect(String(url)).toContain('api.deepgram.com/v1/listen')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Token dg-secret-key')
    expect(init.headers['content-type']).toBe('audio/webm')

    expect(result.transcript).toBe('Send the contract to Dana')
  })

  it('returns an empty transcript when nothing was recognised', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(deepgramResponse(''))
    const result = await transcribeAudio(new Uint8Array([1, 2]), { env: ENV, fetch: fetchImpl })
    expect(result.transcript).toBe('')
  })

  it('throws without leaking the key on a provider failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }))
    const error = await transcribeAudio(new Uint8Array([1]), { env: ENV, fetch: fetchImpl }).catch(
      (e) => e,
    )
    expect(error).toBeInstanceOf(Error)
    expect(String(error.message)).not.toContain('dg-secret-key')
    expect(String(error.message)).toMatch(/transcri|deepgram|speech/i)
  })

  it('fails clearly when not configured', async () => {
    const fetchImpl = vi.fn()
    await expect(
      transcribeAudio(new Uint8Array([1]), { env: {}, fetch: fetchImpl }),
    ).rejects.toThrow(/not configured|DEEPGRAM/i)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
