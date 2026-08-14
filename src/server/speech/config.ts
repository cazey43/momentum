import { isDeepgramConfigured } from './deepgram'
import { isElevenLabsConfigured } from './elevenlabs'

/**
 * Which hosted voice providers are available, decided on the server where the
 * keys live. The booleans (never the keys) are passed to the client, which uses
 * them to choose between the hosted and browser speech adapters.
 */
export interface SpeechAvailability {
  /** Deepgram speech-to-text is configured. */
  hostedStt: boolean
  /** ElevenLabs text-to-speech is configured. */
  hostedTts: boolean
}

export function getSpeechAvailability(): SpeechAvailability {
  return {
    hostedStt: isDeepgramConfigured(),
    hostedTts: isElevenLabsConfigured(),
  }
}
