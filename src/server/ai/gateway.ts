import { AnthropicModelProvider } from '@/adapters/model/anthropic'
import { DeterministicModelProvider } from '@/adapters/model/fake'
import type { ModelProvider } from '@/core/ports/model'

let cached: ModelProvider | null = null

/**
 * Selects the model provider.
 *
 * The deterministic provider wins in three cases: tests, an explicit override,
 * and a missing API key. That last one matters — with no key the app degrades
 * to something honest and still usable rather than erroring, and the UI says
 * which provider answered.
 */
export function getModelProvider(): ModelProvider {
  if (cached) return cached

  const forced = process.env.MOMENTUM_MODEL_PROVIDER?.trim().toLowerCase()
  const isTest = process.env.MOMENTUM_ENV === 'test' || process.env.NODE_ENV === 'test'

  if (isTest || forced === 'fake' || forced === 'deterministic') {
    cached = new DeterministicModelProvider()
    return cached
  }

  const anthropic = new AnthropicModelProvider()
  cached = anthropic.isConfigured() ? anthropic : new DeterministicModelProvider()
  return cached
}

/** Test seam: forces a specific provider. */
export function setModelProvider(provider: ModelProvider | null): void {
  cached = provider
}
