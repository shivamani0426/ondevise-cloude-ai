# PhantomGraph Pipelines 10–14 — Implementation & Verification

This change is based on the Pipeline 9 grounded summary. All work is local-first; no new hosted service, paid model or database is required.

## Pipeline 10 — Evidence Quality
- Source-by-source excerpt coverage and extractor warnings
- Finding-level source coverage and missing comparison context
- Explicitly **not** a statistical fraud score or authenticity certification

## Pipeline 11 — Human Reconciliation
- Investigator selects a rule-based finding, disposition and written reason
- Immutable append-only in-memory event history with current source refs and timestamp
- History discarded when sources are replaced, excerpts corrected, analysis rerun or case cleared
- `verified` means the **investigator** reports external checking, not a machine verdict

## Pipeline 12 — Privacy & Hybrid AI
- Local counts of recognizable sensitive identifiers, without echoing values
- Exact cloud-payload review checkbox required in addition to existing Spark and payload approval
- Changing the preview invalidates prior approval
- `ONLY_ON_DEVICE` has no automatic cloud fallback; no billing enablement

## Pipeline 13 — Graph Trace
- Filter by rule/AI origins, a selected source and a text search
- Display existing graph edges with provenance labels; no new guessed relationships
- Accessible textual trace of the edges

## Pipeline 14 — Report Export
- Existing privacy-redacted text report is preserved
- Schema-versioned JSON case export with source IDs, quality flags and redacted review notes
- Explicit preview and browser **Print → Save as PDF**, entirely local
- Review every character before sharing: automatic masking cannot guarantee removal of all sensitive context
- Browser-print PDF export is not an independently signed or forensically authenticated report

## Release gates
1. `npm run build`
2. `npm run lint`
3. `npm run test:unit`
4. `npm run test:browser` (Chromium and Firefox)
5. Dependency audit checks
6. Manual smoke: invoice $350/$450, status timelines, corrections invalidating review state, cloud preview consent reset, no network exfiltration
7. Review PR and deploy only after checks pass

If this combined PR is merged to main, the earlier Pipeline 9 PR #17 should not be separately merged.
