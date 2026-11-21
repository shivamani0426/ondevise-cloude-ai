# Foundation QA gate — PhantomGraph AI

This maintenance change stays within the approved fictional local-only demo. It does not add evidence uploads, cloud calls, on-device inference, Firebase billing, accounts or database services.

## Confirmed fixes

- Security advisories: npm audit traced four high warnings to `@grpc/grpc-js` pulled in through the Firebase SDK. Targeted `overrides` pins a compatible patched dependency range while keeping the Firebase 12 SDK. Re-audit: **0 vulnerabilities** as of the QA PR checks.
- Repeatable builds: committed `package-lock.json` and made GitHub Actions use `npm ci`.
- Source correctness: selecting the recruiter email on the evidence graph now opens the recruiter email snippet, not the unrelated offer as first source.
- Source dialog: Escape to close, Tab focus containment, and focus restoration. Corrected a falsely confident 'verified reference' label on synthetic data.
- Small-screen graph: cap node offsets to avoid clipping right/left on 390px viewports.
- Status taxonomy: distinguish source-corroborated *domain conflict* from an unsupported fraud determination; the repeated fee remains a possible concern.

## Required gates before release

1. GitHub TypeScript build and ESLint: green
2. GitHub pure data/report regression: green
3. Full `npm audit` / production audit: zero vulnerabilities
4. Chromium and Firefox browser tests: source provenance, focus, report, mobile layout, network silence: green
5. Render deployment shows the exact released commit as live
6. Public website loads and retains an explicit fictional local-only disclaimer

## Not in this milestone

Actual file uploads, parser/OCR, hybrid inference, production Firebase App Check attestation, consented cloud routing and local case persistence. None may be claimed as done until specifically implemented and tested.

## Privacy

Synthetic-only content. No automatic cloud inference and no real sensitive evidence sent by the sample demo. Never activate paid Firebase or Render infrastructure.
