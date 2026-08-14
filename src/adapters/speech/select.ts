'use client'

import type { SpeechToTextProvider, TextToSpeechProvider } from '@/core/ports/speech'
import { BrowserSpeechToText, BrowserTextToSpeech } from './browser'
import { DeepgramSpeechToText } from './deepgram'
import { ElevenLabsTextToSpeech } from './elevenlabs'

/**
 * Chooses speech providers on the client.
 *
 * Prefer the hosted provider when the server says it is configured AND the
 * browser can actually drive it; otherwise fall back to the browser adapter, so
 * voice never silently breaks. The voice UI depends only on the port, so it is
 * unaffected by which one is returned.
 */

export interface SpeechAvailability {
  hostedStt: boolean
  hostedTts: boolean
}

export function selectSpeechToText(availability: SpeechAvailability): SpeechToTextProvider {
  if (availability.hostedStt) {
    const hosted = new DeepgramSpeechToText()
    if (hosted.isAvailable()) return hosted
  }
  return new BrowserSpeechToText()
}

export function selectTextToSpeech(availability: SpeechAvailability): TextToSpeechProvider {
  if (availability.hostedTts) {
    const hosted = new ElevenLabsTextToSpeech()
    if (hosted.isAvailable()) return hosted
  }
  return new BrowserTextToSpeech()
}
