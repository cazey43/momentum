'use client'

import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
  TranscriptChunk,
} from '@/core/ports/speech'

/**
 * Browser Web Speech API adapters.
 *
 * Chosen as the first implementation because it needs no credentials, no
 * network configuration, and no audio leaves the page for TTS. Recognition in
 * some browsers does route audio to a vendor service — that is disclosed in
 * the UI rather than glossed over.
 *
 * The API is not in the standard TypeScript DOM lib, so the minimal surface is
 * declared here rather than pulling in a dependency.
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    readonly length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string; message?: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const candidate = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null
}

/** Turns raw engine errors into something a person can act on. */
function friendlyError(code: string | undefined): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow it in your browser settings, or keep typing.'
    case 'no-speech':
      return 'I did not catch anything. Try again, or type instead.'
    case 'audio-capture':
      return 'No microphone was found. You can keep typing.'
    case 'network':
      return 'Speech recognition needs a network connection and could not reach it.'
    case 'aborted':
      return 'Listening stopped.'
    default:
      return 'Speech recognition stopped unexpectedly. You can keep typing.'
  }
}

export class BrowserSpeechToText implements SpeechToTextProvider {
  readonly id = 'browser-webspeech'

  isAvailable(): boolean {
    return getRecognitionConstructor() !== null
  }

  async start(handlers: {
    onTranscript: (chunk: TranscriptChunk) => void
    onError: (message: string) => void
    onEnd: () => void
  }): Promise<() => void> {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      handlers.onError('This browser cannot do speech recognition. You can keep typing.')
      return () => {}
    }

    const recognition = new Recognition()
    // Push-to-talk: a single utterance, ended by the user releasing the key or
    // button. `continuous` is only enabled by the hands-free opt-in, which
    // lives in the component, not here.
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang =
      typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US'

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (!result) continue
        const alternative = result[0]
        if (!alternative) continue
        handlers.onTranscript({ text: alternative.transcript, isFinal: result.isFinal })
      }
    }

    recognition.onerror = (event) => {
      handlers.onError(friendlyError(event.error))
    }

    recognition.onend = () => {
      handlers.onEnd()
    }

    try {
      recognition.start()
    } catch {
      handlers.onError('Listening could not start. You can keep typing.')
      return () => {}
    }

    return () => {
      try {
        recognition.stop()
      } catch {
        // Already stopped; nothing to do.
      }
    }
  }
}

export class BrowserTextToSpeech implements TextToSpeechProvider {
  readonly id = 'browser-speechsynthesis'

  isAvailable(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  speak(
    text: string,
    handlers?: { onStart?: () => void; onEnd?: () => void; onError?: (m: string) => void },
  ): void {
    if (!this.isAvailable()) {
      handlers?.onError?.('This browser cannot read text aloud.')
      return
    }

    // Cancel anything queued so a new utterance never stacks behind an old one.
    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.pitch = 1
    utterance.onstart = () => handlers?.onStart?.()
    utterance.onend = () => handlers?.onEnd?.()
    utterance.onerror = () => handlers?.onError?.('Playback stopped.')

    window.speechSynthesis.speak(utterance)
  }

  stop(): void {
    if (this.isAvailable()) {
      window.speechSynthesis.cancel()
    }
  }
}
