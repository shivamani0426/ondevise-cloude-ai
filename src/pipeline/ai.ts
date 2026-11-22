import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource, Schema } from 'firebase/ai'
import { CLOUD_MODEL, ensureAppCheckToken, getFirebaseApp, supportsChromeOnDevice } from '../firebase'

// Firebase's on-device Prompt API can constrain generated JSON directly. A prompt
// alone does not guarantee JSON. The ID-only contract constrains format,
// not relevance: the application alone resolves IDs to existing verbatim quotes.
const localReviewSchema = Schema.object({
  properties: {
    selectedIds: Schema.array({ items: Schema.string() }),
    privacyCandidates: Schema.array({ items: Schema.string() }),
  },
})

export type AIResult = { source: 'ON_DEVICE' | 'IN_CLOUD'; text: string }

// A local-only request. Do not replace ONLY_ON_DEVICE with a prefer mode:
// prefer modes may silently upload the prompt when the local model is unavailable.
export async function analyzeWithLocalModel(prompt: string, onProgress: (value: number) => void): Promise<AIResult> {
  if (!supportsChromeOnDevice()) throw new Error('Chrome Desktop 139+ with on-device Prompt API is required.')
  if (prompt.length < 100 || prompt.length > 8000) throw new Error('Local analysis prompt must be between 100 and 8,000 characters.')
  const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() })
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      },
      promptOptions: { responseConstraint: localReviewSchema },
    },
  })
  await model.initializeDeviceModel(onProgress)
  const result = await model.generateContent(prompt)
  if (result.response.inferenceSource !== InferenceSource.ON_DEVICE) {
    throw new Error('Firebase did not verify ON_DEVICE inference. No cloud fallback was allowed.')
  }
  const text = result.response.text().trim()
  if (!text) throw new Error('Local model returned an empty response.')
  return { source: 'ON_DEVICE', text }
}

// The exact text passed here is the exact prompt shown and approved by the user.
// This function never reads File objects, automatically redacts, retries, or falls
// back. The caller must require explicit per-attempt approval of the payload.
export async function analyzeWithCloudModel(approvedPayload: string): Promise<AIResult> {
  if (approvedPayload.length < 150 || approvedPayload.length > 16_000) {
    throw new Error('The approved payload must be 150–16,000 characters.')
  }
  await ensureAppCheckToken()
  const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() })
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: {
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    },
  })
  const result = await model.generateContent(approvedPayload)
  if (result.response.inferenceSource !== InferenceSource.IN_CLOUD) {
    throw new Error('Firebase did not verify IN_CLOUD inference.')
  }
  const text = result.response.text().trim()
  if (!text) throw new Error('Cloud model returned an empty response.')
  return { source: 'IN_CLOUD', text }
}
