import type { z } from 'zod'
import type { UntrustedBlock } from '@/server/ai/untrusted'

/**
 * The model gateway.
 *
 * Domain code depends on this interface, never on an SDK. Swapping providers,
 * or dropping to the deterministic provider when no key is configured, is a
 * configuration change rather than a code change.
 *
 * Note the shape of the contract: there is no `complete(prompt): string`. Every
 * call names a versioned prompt and a schema, so an unvalidated free-text
 * response can never reach the rest of the application.
 */

export interface ModelRequest<T> {
  /** Identifies which versioned prompt this call uses. */
  promptId: string
  promptVersion: string
  /** Operator instructions. Always authored by us, never by retrieved data. */
  system: string
  /** The user's own words, or an internally-composed task description. */
  input: string
  /** Retrieved content, fenced and labeled as data by the provider. */
  untrusted?: readonly UntrustedBlock[]
  /** The response is validated against this before it is returned. */
  schema: z.ZodType<T>
  maxTokens?: number
  /** Overrides the configured reasoning effort for this call. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export interface ModelResult<T> {
  data: T
  /** Which model actually answered, recorded alongside anything persisted. */
  modelId: string
  /** True when the deterministic provider answered, so the UI can say so. */
  isDeterministic: boolean
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

/** Raised when the model declined, so callers can surface it honestly. */
export class ModelRefusalError extends Error {
  readonly category: string | null
  constructor(message: string, category: string | null) {
    super(message)
    this.name = 'ModelRefusalError'
    this.category = category
  }
}

/** Raised when output fails schema validation after retries. */
export class ModelOutputInvalidError extends Error {
  readonly detail: string
  constructor(message: string, detail: string) {
    super(message)
    this.name = 'ModelOutputInvalidError'
    this.detail = detail
  }
}

export interface ModelProvider {
  /** Stable identifier, e.g. 'anthropic' or 'deterministic'. */
  readonly id: string
  /** False when credentials are missing; the UI must say so rather than fake it. */
  isConfigured(): boolean
  generateStructured<T>(request: ModelRequest<T>): Promise<ModelResult<T>>
}
