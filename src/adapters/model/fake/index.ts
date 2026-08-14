import type { ModelProvider, ModelRequest, ModelResult } from '@/core/ports/model'
import { ModelOutputInvalidError } from '@/core/ports/model'
import { looksLikePromptInjection } from '@/server/ai/untrusted'

/**
 * Deterministic ModelProvider.
 *
 * Serves two jobs:
 *
 *   1. Every test runs against it, so the suite never touches a paid API and
 *      never flakes on model variance.
 *   2. It is the fallback when no API key is configured, so demo mode works
 *      with zero credentials. Its output is visibly simpler than the real
 *      model's, and the UI labels it — the app says "running without a model
 *      key" rather than passing keyword matching off as understanding.
 *
 * Its output is validated against the same schema as the real provider, so a
 * schema change that breaks the contract fails loudly here first.
 */
export class DeterministicModelProvider implements ModelProvider {
  readonly id = 'deterministic'

  isConfigured(): boolean {
    return true
  }

  async generateStructured<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
    const raw = this.respond(request)

    const parsed = request.schema.safeParse(raw)
    if (!parsed.success) {
      throw new ModelOutputInvalidError(
        'The deterministic provider produced output that does not match the schema.',
        JSON.stringify(parsed.error.issues.slice(0, 3)),
      )
    }

    return {
      data: parsed.data,
      modelId: 'deterministic',
      isDeterministic: true,
    }
  }

  private respond(request: ModelRequest<unknown>): unknown {
    const untrustedText = (request.untrusted ?? []).map((b) => b.content).join('\n')
    const suspicious = looksLikePromptInjection(untrustedText)

    switch (request.promptId) {
      case 'chat.turn':
        return this.chatTurn(request.input, suspicious)
      case 'detect.commitments':
        return { detections: [], suspiciousContentNoticed: suspicious }
      case 'email.summarize':
        return {
          summary:
            'Running without a model key, so this thread has not been summarized. Open it to read the original.',
          needsReply: false,
          requiresCarefulReview: false,
          category: 'primary',
          confidence: 'low',
          suspiciousContentNoticed: suspicious,
        }
      case 'email.draft':
        return {
          subject: 'Re: (no subject)',
          body: 'Momentum is running without a model key, so it cannot draft a reply. Write one here.',
          confidence: 'low',
          requiresCarefulReview: true,
          assumptions: ['No model was available; this is placeholder text, not a suggestion.'],
        }
      case 'briefing.daily':
        return this.briefing(request.input)
      default:
        throw new ModelOutputInvalidError(
          `The deterministic provider has no handler for prompt "${request.promptId}".`,
          request.promptId,
        )
    }
  }

  /**
   * Keyword intent matching. Deliberately conservative: when nothing matches
   * it says it did not understand rather than guessing at an action.
   */
  private chatTurn(input: string, suspicious: boolean) {
    const text = input.toLowerCase()
    const itemIds = [...input.matchAll(/\bitem_[a-z0-9_]+/gi)].map((m) => m[0])
    const firstId = itemIds[0]

    const proposedActions: unknown[] = []
    let reply: string
    let uncertain = false

    if (/\b(done|handled|finished|completed|sorted)\b/.test(text) && firstId) {
      proposedActions.push({
        type: 'complete_item',
        itemId: firstId,
        reason: 'You said you had handled it.',
      })
      reply = 'Good. I have marked that as done — confirm below and it is off your list.'
    } else if (/\bstop reminding\b|\bdon'?t bring this up\b/.test(text) && firstId) {
      proposedActions.push({
        type: 'mute_reminders',
        itemId: firstId,
        scope: 'forever',
        reason: 'You asked to stop being reminded about this.',
      })
      reply = 'Understood. I will stop bringing that one up. It stays visible in Tasks.'
    } else if (/\b(only|just)\s+(remind me\s+)?once\b/.test(text) && firstId) {
      proposedActions.push({
        type: 'mute_reminders',
        itemId: firstId,
        scope: 'once',
        reason: 'You asked to be reminded only once.',
      })
      reply = 'I will mention it once more, then leave it alone.'
    } else if (/\b(tomorrow|later|not today|next week)\b/.test(text) && firstId) {
      proposedActions.push({
        type: 'snooze_item',
        itemId: firstId,
        untilDate: this.tomorrowIso(),
        reason: 'You asked to set this aside for now.',
      })
      reply = 'Set aside. I will bring it back then, once.'
    } else if (/\b(pep talk|encourage|motivat)/.test(text)) {
      reply =
        'You have fewer open items than it feels like, and only one of them is time-sensitive. Start with that one and the rest gets easier.'
    } else if (/\bwaiting\b/.test(text)) {
      reply =
        'Your Waiting For list has the current answer. I am running without a model key, so I cannot summarize it in prose right now.'
    } else {
      uncertain = true
      reply =
        'Momentum is running without a model key, so I can only handle simple phrasings like "I handled that", "remind me tomorrow", or "stop reminding me". Add ANTHROPIC_API_KEY to .env.local for full conversation.'
    }

    return { reply, proposedActions, uncertain, suspiciousContentNoticed: suspicious }
  }

  private briefing(input: string) {
    const itemIds = [...input.matchAll(/\bitem_[a-z0-9_]+/gi)].map((m) => m[0]).slice(0, 10)
    return {
      short:
        'Momentum is running without a model key, so this is a plain list rather than a written briefing. Your Today view has the full picture.',
      expanded:
        'Add ANTHROPIC_API_KEY to .env.local to get a written briefing that explains what matters and suggests an order.',
      suggestedOrder: itemIds,
      encouragement: null,
    }
  }

  private tomorrowIso(): string {
    // The deterministic provider has no clock injected; callers that need
    // precise dates compute them server-side. This is a coarse default that
    // the user still has to approve.
    const target = new Date(Date.now() + 24 * 60 * 60 * 1000)
    return target.toISOString().slice(0, 10)
  }
}
