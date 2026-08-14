import { describe, expect, it, vi } from 'vitest'
import { checkElevenLabsEnv, isElevenLabsConfigured, synthesizeSpeech } from './elevenlabs'

const ENV = {
  ELEVENLABS_API_KEY: 'sk-eleven-secret',
  ELEVENLABS_VOICE_ID: 'voice-abc',
}

function audioResponse(bytes = [1, 2, 3]) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  })
}

describe('checkElevenLabsEnv', () => {
  it('is ok when the key and voice are present', () => {
    const result = checkElevenLabsEnv(ENV)
    expect(result.ok).toBe(true)
  })

  it('reports each missing value with a fix hint', () => {
    const result = checkElevenLabsEnv({})
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('ELEVENLABS_API_KEY')
    expect(result.problems.join(' ')).toContain('ELEVENLABS_VOICE_ID')
  })

  it('isElevenLabsConfigured mirrors the check', () => {
    expect(isElevenLabsConfigured(ENV)).toBe(true)
    expect(isElevenLabsConfigured({})).toBe(false)
  })
})

describe('synthesizeSpeech', () => {
  it('refuses empty text without calling the network', async () => {
    const fetchImpl = vi.fn()
    await expect(synthesizeSpeech('   ', { env: ENV, fetch: fetchImpl })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts the text to the voice endpoint and returns the audio', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse([9, 8, 7]))

    const result = await synthesizeSpeech('Hello Casey', { env: ENV, fetch: fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const call = fetchImpl.mock.calls[0]
    expect(call).toBeDefined()
    const [url, init] = call as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ]
    expect(String(url)).toContain('/v1/text-to-speech/voice-abc')
    expect(init.method).toBe('POST')
    expect(init.headers['xi-api-key']).toBe('sk-eleven-secret')
    expect(JSON.parse(init.body).text).toBe('Hello Casey')

    expect(result.contentType).toMatch(/audio\/mpeg/)
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([9, 8, 7]))
  })

  it('throws a friendly error on a provider failure, without leaking the key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))

    const error = await synthesizeSpeech('Hi', { env: ENV, fetch: fetchImpl }).catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(String(error.message)).not.toContain('sk-eleven-secret')
    expect(String(error.message)).toMatch(/voice|speech|eleven/i)
  })

  it('fails clearly when not configured', async () => {
    const fetchImpl = vi.fn()
    await expect(synthesizeSpeech('Hi', { env: {}, fetch: fetchImpl })).rejects.toThrow(
      /not configured|ELEVENLABS/i,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
