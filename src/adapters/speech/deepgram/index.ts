'use client'

import type { SpeechToTextProvider, TranscriptChunk } from '@/core/ports/speech'

/**
 * Deepgram speech-to-text (client side).
 *
 * Records one utterance with MediaRecorder, then posts the clip to
 * `/api/speech/stt` and reports the transcript. It implements the same port as
 * the browser adapter, so the voice UI is unchanged.
 *
 * This is batch, not streaming: a single final transcript arrives after the user
 * stops, rather than live interim words. That trade buys a great deal of
 * simplicity and reliability, and push-to-talk already has a clear end.
 *
 * The recording never leaves this adapter except as bytes to the transcription
 * route, and the route returns only text — no audio is surfaced or stored.
 */

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export class DeepgramSpeechToText implements SpeechToTextProvider {
  readonly id = 'deepgram'

  isAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    )
  }

  async start(handlers: {
    onTranscript: (chunk: TranscriptChunk) => void
    onError: (message: string) => void
    onEnd: () => void
  }): Promise<() => void> {
    if (!this.isAvailable()) {
      handlers.onError('This browser cannot record audio. You can keep typing.')
      return () => {}
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      handlers.onError('Microphone access was blocked. Allow it, or keep typing.')
      handlers.onEnd()
      return () => {}
    }

    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: BlobPart[] = []
    let stopped = false

    const releaseMic = () => {
      for (const track of stream.getTracks()) track.stop()
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data)
    }

    recorder.onerror = () => {
      releaseMic()
      handlers.onError('Recording stopped unexpectedly. You can keep typing.')
      handlers.onEnd()
    }

    recorder.onstop = () => {
      releaseMic()
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })

      if (blob.size === 0) {
        handlers.onEnd()
        return
      }

      void (async () => {
        try {
          const response = await fetch('/api/speech/stt', {
            method: 'POST',
            headers: { 'content-type': blob.type },
            body: blob,
          })
          if (!response.ok) {
            handlers.onError('Could not transcribe that. You can keep typing.')
            handlers.onEnd()
            return
          }
          const data = (await response.json()) as { transcript?: string }
          const text = (data.transcript ?? '').trim()
          if (text) handlers.onTranscript({ text, isFinal: true })
          handlers.onEnd()
        } catch {
          handlers.onError('Could not reach the transcription service. You can keep typing.')
          handlers.onEnd()
        }
      })()
    }

    try {
      recorder.start()
    } catch {
      releaseMic()
      handlers.onError('Recording could not start. You can keep typing.')
      handlers.onEnd()
      return () => {}
    }

    // The returned stop() ends the recording, which triggers transcription.
    return () => {
      if (stopped) return
      stopped = true
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          releaseMic()
        }
      }
    }
  }
}
