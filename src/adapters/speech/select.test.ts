import { describe, expect, it } from 'vitest'
import { selectSpeechToText, selectTextToSpeech } from './select'

/**
 * The hosted branches need real browser APIs (MediaRecorder, Audio,
 * SpeechRecognition) that jsdom does not provide, so they are exercised in the
 * browser, not here. What this locks down is the guarantee that matters for
 * correctness: with no hosted provider configured, selection always falls back
 * to the browser adapters rather than returning something unusable.
 */
describe('speech provider selection', () => {
  it('falls back to the browser speech-to-text when hosted STT is off', () => {
    const provider = selectSpeechToText({ hostedStt: false, hostedTts: false })
    expect(provider.id).toBe('browser-webspeech')
  })

  it('falls back to the browser text-to-speech when hosted TTS is off', () => {
    const provider = selectTextToSpeech({ hostedStt: false, hostedTts: false })
    expect(provider.id).toBe('browser-speechsynthesis')
  })
})
