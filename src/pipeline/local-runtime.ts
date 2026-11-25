// Single flight for both local AI paths. SDK operations cannot be aborted here;
// timed out operations are quarantined until settlement, never silently retried.
export type LocalPhase = 'checking' | 'initializing' | 'generating'
export type LocalProgress = (phase: LocalPhase) => void
type PromptAPI = { availability(options?: unknown): Promise<string> }
export async function checkLocalAvailability(): Promise<string> {
  const api = (globalThis as typeof globalThis & { LanguageModel?: PromptAPI }).LanguageModel
  if (!api || typeof api.availability !== 'function') throw new Error('Chrome Prompt API is not enabled. Document checks still work.')
  const state = await api.availability({
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  })
  if (!['available', 'downloadable', 'downloading'].includes(state)) throw new Error('The local model is unavailable. Document checks still work.')
  return state
}
export function createLocalGuard() {
  let inFlight = false
  return async function run<T>(work: (active: () => boolean) => Promise<T>, timeoutMs = 180_000): Promise<T> {
    if (inFlight) throw new Error('A previous local operation is still running. Retry after it finishes or reload the page.')
    inFlight = true
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const operation = Promise.resolve().then(() => work(() => active))
    void operation.then(() => { inFlight = false }, () => { inFlight = false })
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          active = false
          reject(new Error('Local AI timed out. Document findings are safe. Retry after the previous operation finishes or reload the page.'))
        }, timeoutMs)
      })])
    } finally {
      active = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
export const runLocalExclusive = createLocalGuard()
export const localPhaseMessage = (phase: LocalPhase) => ({
  checking: 'Checking local model availability…',
  initializing: 'Preparing or downloading the local model…',
  generating: 'Running the model on this device…',
})[phase]
