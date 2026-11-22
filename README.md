# PhantomGraph AI

Privacy-first evidence investigation workspace for the Firebase AI Logic hybrid-inference hackathon. React + TypeScript + Vite, deployed as a static site. **₹0 billing requirement: stay on Firebase Spark and Render's existing hosting plan.**

## Product workflows

### 1. Analyze Documents — actual local case pipeline

1. In **Analyze Documents**, select up to 8 files (8 MiB per file, 24 MiB combined). PDF, DOCX, TXT, MD, CSV, JSON, PNG and JPEG are supported. Files are not posted to a server; parsing occurs in the browser.
2. **Extract locally**: PDF.js extracts digital PDF pages; Word documents use Mammoth's browser parser; Tesseract OCR handles images and up to four scanned PDF pages. The OCR engine may download public language resources but does **not** upload document pixels. Remaining unreadable PDF pages get explicit correction placeholders. Only the first 25 PDF pages are considered. Excerpts have real page/line/paragraph anchors.
3. **Review and correct excerpts**. Corrections invalidate prior analysis. Corrupt or unsupported files generate a visible error instead of silently passing.
4. **Build evidence graph and findings**: deterministic extraction of domains, amounts, dates, limited organization/person/payment/obligation cues, source-linked nodes and cautious review cues. Compare different fee statements, domain references, compensation figures, joining dates, urgency and credential mentions. A separate context-aware reconciliation checks shipment stage quantities, cancellation/refund windows, activation dates, matching named fee policies, and pending approvals; mismatches are review cues, not definitive legal or fraud findings. Every comparison links to extracted source anchors. Rules do not certify fraud.
5. **Optional on-device AI review**: an explicit user click invokes Firebase AI Logic in `ONLY_ON_DEVICE`. The SDK must confirm `ON_DEVICE` or the review fails. When existing rule findings cite multiple documents, the local review focuses on one such finding and the short text excerpts **already cited by that rule**; generic lexical and numeric overlap prioritizes useful passages. The local model receives up to six short **app-generated verbatim source options** and selects only their IDs (`E1`, `E2`, etc.), plus optional literal privacy candidates. The model never needs to retype PDF/JSON punctuation or source IDs. PhantomGraph rechecks every choice against original extracted text and writes its own cautious finding, ignoring any model-written claims. Unknown or forged choice IDs and invented privacy candidates are rejected; missing/altered original evidence still fails the original quote validator. **A literal privacy suggestion alone is insufficient for redaction**: automatic local-AI suggestions must independently match a recognized personal identifier, a clear organization name, or a name with an explicit source label. Evidence quantities, prices and dates are not automatically masked merely because Nano selected them.
6. **Optional cloud AI review**: prepare a redacted **JSON** payload locally, inspect/edit the exact text, independently confirm Spark/no billing, approve transmission and click Send. Only that text is passed to Gemini Developer API in `ONLY_IN_CLOUD`; App Check is required, and the SDK must report `IN_CLOUD`. No automatic retries/fallback and never upload raw File/Blob bytes. Cloud output uses the same extractive evidence contract and remains untrusted: invalid JSON, unsupported citations and nonliteral quotes are rejected. Accepted AI selections show original snippets, not the cloud model's conclusions, and remain *unverified*.
7. **Export** a redacted TXT report including source IDs and excerpt anchors, limitations and safe next steps. Original filenames are omitted. **Clear case from memory** removes state. No IndexedDB, Firestore, Cloud Storage, account or backend evidence storage is enabled.

### 2. Fictional demo and diagnostic probes

The existing deterministic fictional case, graph, findings, report and separate connectivity probes remain available and unchanged in their original sections. Users can demonstrate the sample without adding personal documents. Independent real-world checks on 22 Nov 2026 confirmed Firebase AI Logic's fixed fictional probe returning `ON_DEVICE` in Chrome and `IN_CLOUD` through Gemini Developer API. These are **connectivity proofs**, not proof of accuracy on actual case files.

## Important limitations

- No automated classifier can reliably decide whether every document phrase is confidential. AI-suggested non-identifier text is intentionally ignored for **automatic** redaction, including proprietary quantities or dates. If those facts are confidential, manually remove them from the cloud draft and inspect the report before sharing. The local originals and deterministic case findings remain unchanged.
- Automatic PII masking is incomplete. It detects common emails, phone numbers, PAN/Aadhaar-style IDs, long card/bank identifiers, payment IDs, secret fields and URLs with query strings, but may miss names, addresses, context or unusual identifiers. **Do not submit sensitive real-world documents to the free cloud model.** Use fictional/synthetic or carefully reviewed, sanitized text only. Free-tier API prompts may be used by the provider to improve its products.
- PDF/Word parsing, extraction and OCR can lose layout or make mistakes. Digital PDF pages are capped at 25 and scanned-page OCR at 4. Manually correct or transcribe unreadable excerpts before running analysis. PDF/PNG/JPEG/DOCX decoding is never guaranteed for every possible file.
- Entity and rule-based findings are heuristics, not calibrated criminal, financial, identity or legal determinations. Matching an AI-selected quotation confirms only that a string appears in the *extracted text*, not that the original document is authentic or the AI selected relevant material. **No automated system can guarantee correctness for every document.** Review the original and surrounding context. An AI-generated explanation never becomes a verified factual finding.
- On-device Gemini Nano requires supported desktop Chrome, model availability, download resources and user activation. Firefox and mobile retain deterministic analysis but cannot run that model. Browser-only case state is lost on reload.
- Source-scoped relevance narrows model attention to an existing rule finding when multiple sources are cited. Selecting a source passage validates only its text and citation; it does **not** verify that it actually proves a discrepancy or that the selected sources address the same transaction. The focused AI result is explicitly labelled as unverified.
- The ID-selection change is designed to reduce the observed invalid-copy problem, **not** to guarantee that the local model will choose relevant evidence. Browser CI can test the local validator and block unsanctioned cloud requests in an upload flow, but cannot prove Gemini Nano behavior or intercept every possible network route on the user's machine. A fresh voluntary Chrome test remains necessary.
- As of 22 Nov 2026 this Firebase project's Gemini Developer API free-tier status is Restricted (403). App Check token retrieval can succeed while model generation remains forbidden. The cloud option is not verified usable in production; local extraction, cautious reconciliation, and explicit ONLY_ON_DEVICE review continue independently. Do not enable paid billing or silently switch providers.
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

- Unit tests verify source validity, cautious categories, amount and date conflict rules, literal quotations and wrong-source rejection, negation/number perturbations, nine unrelated document subjects and supported extraction formats, PII canaries, consent, structured payload/response handling and redacted export.
- Chromium and Firefox browser tests exercise local text/PDF/DOCX/CSV/JSON/MD ingestion, graph navigation, citation inspection, manual corrections, error handling, cloud consent gating, report download and mobile overflow.
- Security gate: patched production dependencies and `npm audit --omit=dev --audit-level=high`.
- Browser CI does not prove that a particular user's PDF, image OCR, Firebase configuration or actual cloud reasoning will succeed. Independently test representative cases on the deployed site before claiming complete live validation.
