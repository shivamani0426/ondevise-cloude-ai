import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'

// No AI request is made here. App Check verification is an explicit user action.
// Render's URL must be added to the reCAPTCHA Enterprise site's allowed domains.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
}
const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || ''

export const firebaseConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId && siteKey
)

let instance: FirebaseApp | null = null

export async function verifyAppCheck(): Promise<string> {
  if (!firebaseConfigured) {
    return 'Firebase SDK configuration is not supplied to this deployment yet. No AI or App Check requests were made.'
  }
  try {
    instance = instance || (getApps().length ? getApp() : initializeApp(config))
    const appCheck = initializeAppCheck(instance, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    })
    const token = await getToken(appCheck, false)
    if (!token.token) return 'App Check did not return an attestation token.'
    return 'App Check token obtained on this browser. AI Logic inference has not been tested yet.'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown attestation error'
    return 'App Check attestation failed: ' + message + '. Check allowed website domains and SDK configuration.'
  }
}
