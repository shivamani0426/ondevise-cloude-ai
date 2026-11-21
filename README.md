# PhantomGraph AI

A privacy-first, evidence-led fraud-indicator investigation workspace for the Firebase hybrid-inference hackathon.

## Current state

- **Foundation / fictional demo only.** Inspect a sample investigation graph, source-linked findings and a downloadable text report. The sample is explicitly fictional.
- This release **does not** claim that Firebase AI Logic, on-device AI, cloud AI, scanned PDFs, or real-file processing are operational.
- Original sensitive evidence is not uploaded; no API request is made from the demo.
- Firebase App Check and AI Logic integration is gated on confirmed web configuration, a registered Render domain and real device capability checks.
- Firebase Spark and Render Static Site only, no paid services.

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

All sample content is fictional. No upload or cloud AI feature is connected in this milestone. Do not feed real private documents to experimental or free cloud models. Source citations must resolve to local evidence or be explicitly labeled unverified.
