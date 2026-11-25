# Local-only release candidate: pipelines 15–19

This is a candidate, not a verified production release. Cloud inference is disabled at the UI and inference entry points; redacted previews remain local. No billing or dependency additions.

- 15: shared local AI availability check, progress phases, bounded 180-second wait, quarantine of outstanding SDK calls, explicit retry. SDK calls cannot be forcibly aborted here; reload may be required.
- 16: conservative affirmative narrative patterns with a full explicit identity, narrow aliases, existing context gates and anchored comparisons. Incomplete IDs are deliberately not linked automatically. Other prose, multi-event relationships and complex conditions still need manual review.
- 17: simple-mode expandable interactive graph with source inspection; advanced controls preserved.
- 18: new synthetic cross-domain positive and negative unit cases plus browser graph and cloud-disabled assertions. Synthetic fixtures do not measure field accuracy on real-world originals.
- 19: existing CI runs build, lint, unit, browser and dependency audit; require successful checks before merge. Actual results must be recorded from CI, not inferred.

## Release gates
1. Check CI for this exact commit: typecheck/build, lint, unit, Chromium/Firefox and dependency audit.
2. On supported desktop Chrome, run local diagnostics and a sample investigation; verify download, readiness, result and manual retry. On Firefox, confirm deterministic mode remains usable.
3. Test unfamiliar redacted or fictional records with normal transitions, different identifiers, mixed currencies and ambiguous terms. Check original citations.
4. Inspect network requests during analysis, verify no AI cloud egress, clear the case and reload. Check memory and responsiveness on a low-resource laptop.
5. Keep Render on the previous working commit until all release gates are satisfied. Demo: sample case, source lines, evidence connections, redacted export, local AI if supported. Never claim fraud is confirmed.

Real-device Nano, representative real-document validation, security/performance review and live Render verification remain necessary before final release certification.
