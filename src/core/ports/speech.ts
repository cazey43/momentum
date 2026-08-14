/**
 * Speech ports.
 *
 * The browser Web Speech API is the first implementation, but it sits behind
 * these interfaces so a hosted provider (Deepgram, ElevenLabs, Whisper) can be
 * dropped in without touching the voice UI. The UI depends only on the states
 * and callbacks declared here.
 *
 * Privacy constraints baked into the shape:
 * - There is no `getAudioBlob()` or `recordingUrl`. Raw audio is never
 *   surfaced, so it cannot accidentally be persisted.
 * - Listening is always explicitly started. Nothing here can begin listening
 *   on its own.
 */

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'muted' | 'error'

export interface TranscriptChunk {
  text: string
  /** False while the engine may still revise this text. */
  isFinal: boolean
}

export interface SpeechToTextProvider {
  readonly id: string
  /** False when the environment cannot do speech recognition at all. */
  isAvailable(): boolean
  /**
   * Begins listening. Must only ever be called from an explicit user gesture.
   * Returns a stop function.
   */
  start(handlers: {
    onTranscript: (chunk: TranscriptChunk) => void
    onError: (message: string) => void
    onEnd: () => void
  }): Promise<() => void>
}

export interface TextToSpeechProvider {
  readonly id: string
  isAvailable(): boolean
  speak(
    text: string,
    handlers?: { onStart?: () => void; onEnd?: () => void; onError?: (m: string) => void },
  ): void
  /** Interrupt. Must take effect immediately. */
  stop(): void
}
