import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  ModelOutputInvalidError,
  type ModelProvider,
  ModelRefusalError,
  type ModelRequest,
  type ModelResult,
} from '@/core/ports/model'
import { renderUntrusted } from '@/server/ai/untrusted'

const DEFAULT_MODEL = 'claude-opus-5'
const DEFAULT_MAX_TOKENS = 16000

type Effort = NonNullable<ModelRequest<unknown>['effort']>

function resolveEffort(): Effort {
  const configured = process.env.MOMENTUM_MODEL_EFFORT
  const allowed: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
  return allowed.includes(configured as Effort) ? (configured as Effort) : 'medium'
}

/**
 * Anthropic-backed ModelProvider.
 *
 * Uses structured outputs (`output_config.format`) rather than asking for JSON
 * in the prompt and parsing it: the response is constrained to the schema at
 * the API level, which removes an entire class of "the model wrote prose
 * instead of JSON" failures.
 *
 * Thinking is left at its default (adaptive, on by default for this model) and
 * depth is controlled with `effort` — the deprecated `budget_tokens` knob is
 * not used, and sampling parameters are not sent at all since this model
 * rejects them.
 */
export class AnthropicModelProvider implements ModelProvider {
  readonly id = 'anthropic'
  private readonly client: Anthropic | null
  private readonly model: string

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
    this.client = apiKey ? new Anthropic({ apiKey }) : null
    this.model = process.env.MOMENTUM_MODEL?.trim() || DEFAULT_MODEL
  }

  isConfigured(): boolean {
    return this.client !== null
  }

  async generateStructured<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
    if (!this.client) {
      throw new Error(
        'The Anthropic provider has no API key. Set ANTHROPIC_API_KEY, or run with MOMENTUM_MODEL_PROVIDER=fake.',
      )
    }

    const untrusted = renderUntrusted(request.untrusted ?? [])

    // Order matters for prompt caching: the stable system prompt first, the
    // volatile per-request content last.
    const userContent = untrusted.text ? `${request.input}\n\n${untrusted.text}` : request.input

    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: request.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userContent }],
      output_config: {
        format: zodOutputFormat(request.schema),
        effort: request.effort ?? resolveEffort(),
      },
    })

    // Check the stop reason before touching content: a refusal returns HTTP 200
    // with empty or partial content, and indexing content[0] would throw.
    if (response.stop_reason === 'refusal') {
      throw new ModelRefusalError(
        'The model declined to answer this request.',
        response.stop_details?.category ?? null,
      )
    }

    const parsed = response.parsed_output
    if (parsed === null || parsed === undefined) {
      throw new ModelOutputInvalidError(
        'The model returned a response that did not match the expected shape.',
        `stop_reason=${String(response.stop_reason)}`,
      )
    }

    return {
      data: parsed as T,
      modelId: response.model ?? this.model,
      isDeterministic: false,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    }
  }
}
