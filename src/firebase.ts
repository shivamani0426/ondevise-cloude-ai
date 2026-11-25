import { checkLocalAvailability, runLocalExclusive } from './pipeline/local-runtime'
import type { LocalProgress } from './pipeline/local-runtime'
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check'
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource } from 'firebase/ai'

// Only explicit diagnostic button presses initiate AI inference.
// Never send case evidence, files, or user text in a diagnostic request.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
}
const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || ''
const PROBE_PROMPT = 'This is a fictional connection test, not an investigation. Reply with exactly: PHANTOMGRAPH_PROBE_OK'
export const CLOUD_MODEL = 'gemini-3.5-flash-lite'
export const CLOUD_ENABLED = false

export const firebaseConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId && siteKey
)

let instance: FirebaseApp | null = null
let appCheckInstance: AppCheck | null = null

export function getFirebaseApp(): FirebaseApp {
  if (!firebaseConfigured) throw new Error('Firebase web configuration is missing.')
  instance = instance || (getApps().length ? getApp() : initializeApp(config))
  return instance
}

// Reuse one App Check instance. Calling initializeAppCheck repeatedly with a
// new provider object may trigger an already-initialized error.
export async function ensureAppCheckToken(): Promise<void> {
  const app = getFirebaseApp()
  appCheckInstance = appCheckInstance || initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  })
  const result = await getToken(appCheckInstance, false)
  if (!result.token) throw new Error('App Check did not return an attestation token.')
}

export async function verifyAppCheck(): Promise<string> {
  if (!firebaseConfigured) return 'Firebase SDK configuration is not supplied to this deployment yet. No AI or App Check requests were made.'
  try {
    await ensureAppCheckToken()
    return 'App Check token obtained on this browser. AI Logic inference has not been tested yet.'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown attestation error'
    return 'App Check attestation failed: ' + message + '. Check allowed website domains and SDK configuration.'
  }
}

export function supportsChromeOnDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const match = ua.match(/Chrome\/(\d+)/)
  return Boolean(match && Number(match[1]) >= 139 && !/Android|Mobile|Edg\/|OPR\//.test(ua))
}

export type InferenceProbe = { source: 'ON_DEVICE' | 'IN_CLOUD'; text: string }

// Called synchronously from a user click. ONLY_ON_DEVICE guarantees that a
// missing local model produces an error, never an unexpected cloud request.
export async function runDeviceProbe(onProgress: (fraction: number) => void, onPhase: LocalProgress = () => {}): Promise<InferenceProbe> {
  return runLocalExclusive(async active => {
  onPhase('checking')
  await checkLocalAvailability()
  if (!active()) throw new Error('Local probe expired.')
  if (!supportsChromeOnDevice()) throw new Error('On-device inference requires Chrome Desktop 139+ with the Prompt API enabled.')
  const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() })
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      },
    },
  })
  onPhase('initializing')
  await model.initializeDeviceModel(value => { if (active()) onProgress(value) })
  if (!active()) throw new Error('Local probe expired.')
  onPhase('generating')
  const result = await model.generateContent(PROBE_PROMPT)
  if (!active()) throw new Error('Local probe expired.')
  if (result.response.inferenceSource !== InferenceSource.ON_DEVICE) {
    throw new Error('The SDK did not confirm an on-device inference source.')
  }
  const text = result.response.text().trim()
  if (!text) throw new Error('The on-device model returned no text.')
  return { source: 'ON_DEVICE', text: text.slice(0, 400) }
  })
}

// This function may send a fixed *fictional* prompt to Gemini Developer API.
// The UI requires a fresh click and explicit Spark/no-billing confirmation.
// A missing App Check token blocks the request. No automatic fallback occurs.
export async function runCloudProbe(): Promise<InferenceProbe> {
  if (!CLOUD_ENABLED) throw new Error('Cloud AI is disabled for this release.')
  await ensureAppCheckToken()
  const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() })
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: { maxOutputTokens: 96 },
    },
  })
  const result = await model.generateContent(PROBE_PROMPT)
  if (result.response.inferenceSource !== InferenceSource.IN_CLOUD) {
    throw new Error('The SDK did not confirm a cloud inference source.')
  }
  const text = result.response.text().trim()
  if (!text) throw new Error('The cloud model returned no text.')
  return { source: 'IN_CLOUD', text: text.slice(0, 400) }
}
