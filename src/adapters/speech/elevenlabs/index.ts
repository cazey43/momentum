'use client'

import type { TextToSpeechProvider } from '@/core/ports/speech'

/**
 * ElevenLabs text-to-speech (client side).
 *
 * The heavy lifting and the API key live on the server; this adapter only posts
 * text to `/api/speech/tts` and plays the audio that comes back. It implements
 * the same port as the browser adapter, so the voice UI does not know or care
 * which one is in use.
 *
 * No audio is retained: the object URL is revoked as soon as playback ends or is
 * stopped, and nothing is ever handed back through the port.
 */
export class ElevenLabsTextToSpeech implements TextToSpeechProvider {
  readonly id = 'elevenlabs'

  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private controller: AbortController | null = null

  isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.Audio !== 'undefined'
  }

  speak(
    text: string,
    handlers?: { onStart?: () => void; onEnd?: () => void; onError?: (m: string) => void },
  ): void {
    if (!this.isAvailable()) {
      handlers?.onError?.('This browser cannot play audio.')
      return
    }

    // Never stack a new utterance on top of an old one.
    this.stop()
    const controller = new AbortController()
    this.controller = controller

    void (async () => {
      let response: Response
      try {
        response = await fetch('/api/speech/tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        })
      } catch {
        if (!controller.signal.aborted) handlers?.onError?.('Could not reach the voice service.')
        return
      }

      if (!response.ok) {
        handlers?.onError?.('Could not read that aloud.')
        return
      }

      const blob = await response.blob()
      if (controller.signal.aborted) return

      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      this.audio = audio
      this.objectUrl = url

      const cleanup = () => {
        if (this.objectUrl === url) {
          URL.revokeObjectURL(url)
          this.objectUrl = null
        }
        if (this.audio === audio) this.audio = null
      }

      audio.onplay = () => handlers?.onStart?.()
      audio.onended = () => {
        cleanup()
        handlers?.onEnd?.()
      }
      audio.onerror = () => {
        cleanup()
        handlers?.onError?.('Playback stopped.')
      }

      try {
        await audio.play()
      } catch {
        cleanup()
        if (!controller.signal.aborted) handlers?.onError?.('Playback could not start.')
      }
    })()
  }

  stop(): void {
    this.controller?.abort()
    this.controller = null

    if (this.audio) {
      this.audio.onended = null
      this.audio.onerror = null
      try {
        this.audio.pause()
      } catch {
        // Nothing to pause.
      }
      this.audio = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }
}
