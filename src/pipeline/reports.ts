import type { Investigation } from './core.ts'
import { redactWithSuggestions, reportInvestigation } from './core.ts'
import { evaluateEvidenceQuality } from './quality.ts'
import { currentReviews, explainDecision } from './reconciliation.ts'
import type { ReviewEvent } from './reconciliation.ts'

export type CaseExport = {
  schema: 'phantomgraph.local-investigation.v1'
  generatedAt: string
  privacy: string[]
  sources: Array<{id:string;format:string;excerptCount:number}>
  quality: ReturnType<typeof evaluateEvidenceQuality>
  reviews: Array<{findingId:string;decision:string;reason:string;recordedAt:string;sourceRefs:string[]}>
  redactedReport: string
}

/** Pipeline 14: derive all exports locally, with the same redaction as the existing text report. */
export function buildCaseExport(investigation: Investigation, reviews: ReviewEvent[], suggestions: string[]=[]): CaseExport {
  const context = investigation.documents.flatMap(d=>d.segments.map(s=>s.text)).join('\n')
  const safe = (input: string): string => {
    let value = input
    for (const doc of investigation.documents) {
      if(doc.name) value = value.split(doc.name).join('[SOURCE_NAME_REDACTED]')
    }
    return redactWithSuggestions(value,suggestions,context).text
  }
  const quality = evaluateEvidenceQuality(investigation)
  const relevant = currentReviews(investigation,reviews)
  const report = reportInvestigation(investigation,suggestions)
  const additional = [
    '',
    'EVIDENCE COVERAGE AND QUALITY (NOT FRAUD PROBABILITY)',
    'Sources cited by any current finding: ' + quality.coveredSourceCount + '/' + quality.totalSourceCount,
    ...quality.sources.map(s=>'Source '+s.id+' | '+s.excerpts+' excerpts | '+s.citedExcerpts+' cited | '+s.level+
      (s.notes.length ? ' | '+s.notes.join('; ') : '')),
    ...quality.findings.map(f=>'Rule finding '+f.id+' | '+f.citedSources+' cited source(s) | '+f.level+
      ' | '+f.notes.join('; ')),
    '',
    'INVESTIGATOR DECISIONS (HUMAN-REPORTED, NOT INDEPENDENTLY AUTHENTICATED)',
    ...(relevant.length ? relevant.flatMap(event=>[
      'Finding '+event.findingId+' | '+event.decision+' | '+event.recordedAt,
      'Recorded explanation: '+safe(event.reason),
      'Scope: '+event.sourceRefs.join(', '),
      explainDecision(event.decision),
    ]) : ['No investigator reconciliation decisions have been recorded.']),
    '',
    'REPORT EXPORT LIMITATIONS',
    'This document contains extracted and automatically redacted evidence, not authenticated originals.',
    'Inspect this entire preview before saving or sharing; masking can miss sensitive context.',
    'The user can print this local preview to PDF using the browser. No server PDF generation is used.',
  ]
  return {
    schema:'phantomgraph.local-investigation.v1',
    generatedAt:new Date().toISOString(),
    privacy:[
      'No original source filenames are intentionally included.',
      'This export is generated in the browser with no server-side storage.',
      'Automatic masking is incomplete; review the text before sharing.',
    ],
    sources:investigation.documents.map(doc=>({id:doc.id,format:doc.format,excerptCount:doc.segments.length})),
    quality,
    reviews:relevant.map(event=>({findingId:event.findingId,decision:event.decision,reason:safe(event.reason),
      recordedAt:event.recordedAt,sourceRefs:event.sourceRefs})),
    redactedReport:report+'\n'+additional.map(safe).join('\n'),
  }
}

export function makeRedactedCaseJson(investigation: Investigation, reviews: ReviewEvent[], suggestions: string[]=[]): string {
  return JSON.stringify(buildCaseExport(investigation,reviews,suggestions),null,2)
}
