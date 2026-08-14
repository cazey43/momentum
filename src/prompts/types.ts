/**
 * Prompts are data, not code.
 *
 * Each carries an explicit semantic version. Anything persisted that was
 * produced by a model records the prompt id and version alongside it, so a
 * change in behavior can always be traced to the prompt revision that caused
 * it.
 */
export interface PromptDefinition {
  id: string
  version: string
  system: string
}

export function promptLabel(prompt: PromptDefinition): string {
  return `${prompt.id}@${prompt.version}`
}
