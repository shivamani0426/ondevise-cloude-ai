import type { EvidenceDocument } from './core.ts'
import { redactForCloud, validateApprovedCloudPayload } from './core.ts'

export type PrivacyInspection = {
  sourceCount: number
  detectedOccurrences: number
  detectedCategories: string[]
  sourceFlags: Array<{ sourceId: string; occurrences: number; categories: string[] }>
  warnings: string[]
}

/** Pipeline 12: diagnostic counts only; no original identifier values leave local state. */
export function inspectPrivacy(documents: EvidenceDocument[]): PrivacyInspection {
  const sourceFlags = documents.map(doc => {
    const scans = doc.segments.map(s => redactForCloud(s.text))
    return { sourceId: doc.id, occurrences: scans.reduce((n,s)=>n+s.count,0),
      categories: [...new Set(scans.flatMap(s=>s.categories))] }
  })
  return {
    sourceCount: documents.length,
    detectedOccurrences: sourceFlags.reduce((n,s)=>n+s.occurrences,0),
    detectedCategories: [...new Set(sourceFlags.flatMap(s=>s.categories))],
    sourceFlags,
    warnings: [
      'Automated masking is incomplete: personal names, addresses, contextual secrets and private relationships may be missed.',
      'An AI-selected phrase is not accepted as private information without independent source checks.',
      'Cloud review stays off by default and cannot run without a validated, explicitly approved exact payload.',
      'The local model has no automatic cloud fallback.',
    ],
  }
}

export function cloudPrivacyGate(payload: string, documents: EvidenceDocument[], reviewed: boolean): string | null {
  if (!reviewed) return 'Confirm you independently checked names, addresses and remaining private context in the exact cloud preview.'
  return validateApprovedCloudPayload(payload, documents)
}
