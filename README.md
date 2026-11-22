# PhantomGraph AI

Privacy-first evidence investigation workspace for the Firebase AI Logic hybrid-inference hackathon. React + TypeScript + Vite, deployed as a static site. **₹0 billing requirement: stay on Firebase Spark and Render's existing hosting plan.**

## Product workflows

### 1. Analyze Documents — actual local case pipeline

1. In **Analyze Documents**, select up to 8 files (8 MiB per file, 24 MiB combined). PDF, DOCX, TXT, MD, CSV, JSON, PNG and JPEG are supported. Files are not posted to a server; parsing occurs in the browser.
2. **Extract locally**: PDF.js extracts digital PDF pages; Word documents use Mammoth's browser parser; Tesseract OCR handles images and up to four scanned PDF pages. The OCR engine may download public language resources but does **not** upload document pixels. Remaining unreadable PDF pages get explicit correction placeholders. Only the first 25 PDF pages are considered. Excerpts have real page/line/paragraph anchors.
3. **Review and correct excerpts**. Corrections invalidate prior analysis. Corrupt or unsupported files generate a visible error instead of silently passing.
4. **Build evidence graph and findings**: deterministic extraction of domains, amounts, dates, limited organization/person/payment/obligation cues, source-linked nodes and cautious review cues. Compare different fee statements, domain references, compensation figures, joining dates, urgency and credential mentions. Rules do not certify fraud.
5. **Optional on-device AI review**: an explicit user click invokes Firebase AI Logic in `ONLY_ON_DEVICE`. The SDK must confirm `ON_DEVICE` or the review fails. The local model may suggest source-grounded hypotheses and literal privacy candidates. Unknown source citations and candidate strings absent from the local evidence are rejected.
6. **Optional cloud AI review**: prepare a redacted **JSON** payload locally, inspect/edit the exact text, independently confirm Spark/no billing, approve transmission and click Send. Only that text is passed to Gemini Developer API in `ONLY_IN_CLOUD`; App Check is required, and the SDK must report `IN_CLOUD`. No automatic retries/fallback and never upload raw File/Blob bytes. Cloud output is not trusted: invalid JSON/unknown citations are discarded, and accepted hypotheses remain visibly *unverified*.
7. **Export** a redacted TXT report including source IDs and excerpt anchors, limitations and safe next steps. Original filenames are omitted. **Clear case from memory** removes state. No IndexedDB, Firestore, Cloud Storage, account or backend evidence storage is enabled.

### 2. Fictional demo and diagnostic probes

The existing deterministic fictional case, graph, findings, report and separate connectivity probes remain available and unchanged in their original sections. Users can demonstrate the sample without adding personal documents. Independent real-world checks on 22 Nov 2026 confirmed Firebase AI Logic's fixed fictional probe returning `ON_DEVICE` in Chrome and `IN_CLOUD` through Gemini Developer API. These are **connectivity proofs**, not proof of accuracy on actual case files.

## Important limitations

- Automatic PII masking is incomplete. It detects common emails, phone numbers, PAN/Aadhaar-style IDs, long card/bank identifiers, payment IDs, secret fields and URLs with query strings, but may miss names, addresses, context or unusual identifiers. **Do not submit sensitive real-world documents to the free cloud model.** Use fictional/synthetic or carefully reviewed, sanitized text only. Free-tier API prompts may be used by the provider to improve its products.
- PDF/Word parsing, extraction and OCR can lose layout or make mistakes. Digital PDF pages are capped at 25 and scanned-page OCR at 4. Manually correct or transcribe unreadable excerpts before running analysis. PDF/PNG/JPEG/DOCX decoding is never guaranteed for every possible file.
- Entity and rule-based findings are heuristics, not calibrated criminal, financial, identity or legal determinations. Context, dates, provenance and supporting citations must be reviewed by humans. A matching source ID does not make an AI interpretation factually correct.
- On-device Gemini Nano requires supported desktop Chrome, model availability, download resources and user activation. Firefox and mobile retain deterministic analysis but cannot run that model. Browser-only case state is lost on reload.
- The cloud model and free quota are project/provider-dependent. Never enable Blaze, paid APIs, hidden retries, unrestricted uploads or automatic cloud fallback to make a demo pass.

## Development

```bash
npm ci
npm run lint
npm run build
npm run test:unit
npx playwright install --with-deps chromium firefox
npm run test:browser
npm audit --omit=dev --audit-level=high
```

For Firebase configuration, copy `.env.example` to `.env.local`. No administrative credentials or debug App Check tokens should be committed. Firebase App Check needs the production Render domain in the reCAPTCHA Enterprise allowlist and should be enforced for Firebase AI Logic by Firebase Console.

**Render static site**: build `npm install --no-audit --no-fund && npm run build`; publish `dist`. All document parsing, analysis and graph creation happen in the user's browser.

## Verification / privacy engineering

- Unit tests verify source validity, cautious categories, amount and date conflict rules, PII canaries, literal local-AI privacy candidates, structured payload/response handling and redacted export.
- Chromium and Firefox browser tests exercise local text/PDF/DOCX ingestion, graph navigation, citation inspection, manual corrections, error handling, cloud consent gating, report download and mobile overflow.
- Security gate: patched production dependencies and `npm audit --omit=dev --audit-level=high`.
- Browser CI does not prove that a particular user's PDF, image OCR, Firebase configuration or actual cloud reasoning will succeed. Independently test representative cases on the deployed site before claiming complete live validation.
