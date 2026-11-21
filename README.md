# PhantomGraph AI

A privacy-first, evidence-led fraud-indicator investigation workspace for the Firebase hybrid-inference hackathon.

## Current state

- **Foundation / fictional investigation only.** Inspect a sample graph, source-linked findings and a downloadable text report. All case information is explicitly fictional.
- Firebase AI Logic connectivity is available **only through explicit diagnostic buttons** in Overview. Neither on-device nor cloud inference is considered operational until a real test completes and reports its SDK inference source. PDF ingestion and real-file processing are not implemented.
- Original sensitive evidence is not accepted or uploaded. The investigation makes no AI requests. An optional cloud diagnostic sends only a fixed fictional prompt after the user confirms the Firebase Spark/no-billing plan.
- Firebase App Check has a manual verification button. The on-device probe uses ONLY_ON_DEVICE, requires Chrome Desktop 139+ with Prompt API enabled, and cannot silently fall back to cloud. The cloud probe uses ONLY_IN_CLOUD, requires a valid App Check token, and makes at most one attempt per page load.
- Firebase Spark and Render Static Site only; the cloud probe is conditional on verified Spark/no billing and free-tier availability. Never switch to Blaze or the billing-required Agent Platform Gemini API for this project.

## Local development

```bash
npm install
npm run dev
npm run lint
npm run build
```

Copy `.env.example` to `.env.local` only when Firebase configuration is available. Never commit debug tokens.

## Hosting

Render Static Site, build command `npm install && npm run build`, publish path `dist`. React and Vite run entirely in the browser.

## Privacy/security

All case content is fictional. No real-file ingestion, automatic hybrid fallback or analysis of case documents is connected. Diagnostic AI uses only a hard-coded fictional prompt. Do not send private documents to experimental or free cloud models. Source citations must resolve to local evidence or be explicitly labeled unverified.

## Manual Firebase AI Logic diagnostic verification

1. Confirm the Firebase project is on Spark **without any linked billing account**, and that Firebase AI Logic is configured for the **Gemini Developer API**, not the billing-required Agent Platform Gemini API. Confirm `gemini-3.5-flash-lite` has a free-tier quota in that project.
2. In Firebase Console > App Check > APIs, confirm that App Check is **enforced** for Firebase AI Logic. The Render origin must remain in the reCAPTCHA Enterprise allowlist.
3. Open Overview on the production Render site and run Verify App Check token; this validates attestation only.
4. For local inference, open Chrome Desktop 139+ with Prompt API enabled and click Test on-device inference. The test must explicitly return `ON_DEVICE`; Firefox cannot run this local test. First-time model download may require storage and significant time.
5. For cloud inference, on the Spark project, confirm the no-billing checkbox and click Send one fictional cloud test. It sends `PHANTOMGRAPH_PROBE_OK` instructions, not investigation evidence. The test must return `IN_CLOUD` and real model output. If denied by quota or configuration, report failure honestly; never enable billing to make the test pass.
6. The tests in this PR are code and browser regression tests. They do **not** constitute a live model inference test; manual production validation is required before merging or claiming operational hybrid AI.

