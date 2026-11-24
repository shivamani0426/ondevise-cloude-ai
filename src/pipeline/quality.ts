import type { Investigation } from './core.ts'
import { buildInvestigationSummary } from './summary.ts'

export type EvidenceQuality = {
  sources: Array<{ id: string; format: string; excerpts: number; citedExcerpts: number; level: 'Readable excerpts' | 'Manual review needed' | 'No usable excerpts'; notes: string[] }>
  findings: Array<{ id: string; title: string; citedSources: number; citedExcerpts: number; level: 'Source-linked; context unverified' | 'Insufficient source coverage'; notes: string[] }>
  warnings: string[]
  coveredSourceCount: number
  totalSourceCount: number
}

/** Pipeline 10: evidence coverage and limitations, NEVER fraud likelihood. */
export function evaluateEvidenceQuality(investigation: Investigation): EvidenceQuality {
  const summary = buildInvestigationSummary(investigation)
  const cited = new Set(investigation.findings.flatMap(f => f.refs))
  const sources = investigation.documents.map(doc => {
    const excerpts = doc.segments.length
    const citedExcerpts = doc.segments.filter(s => cited.has(doc.id + ':' + s.id)).length
    const notes = [...doc.warnings.map(() => 'The extractor flagged an issue; check the original source.')]
    if (!excerpts || doc.segments.every(s => /^\[No (?:extractable|readable)/i.test(s.text))) {
      notes.push('No usable extracted text. Manual source inspection is required.')
    }
    if (excerpts >= 240) notes.push('Excerpt limit reached; source content may have been truncated.')
    if (['PDF','DOCX','PNG','JPG','JPEG'].includes(doc.format.toUpperCase())) {
      notes.push('Layout, images, signatures or OCR may not be preserved in extracted text.')
    }
    if (!citedExcerpts && excerpts) notes.push('No current finding cites this source; this is not evidence that the source is accurate.')
    return { id: doc.id, format: doc.format, excerpts, citedExcerpts,
      level: (!excerpts || doc.segments.every(s => /^\[No (?:extractable|readable)/i.test(s.text)))
        ? 'No usable excerpts' as const : notes.length ? 'Manual review needed' as const : 'Readable excerpts' as const,
      notes: [...new Set(notes)].slice(0, 6) }
  })
  const findings = summary.findings.map(finding => {
    const citedSources = new Set(finding.citations.map(c => c.documentId)).size
    const notes: string[] = [
      'Source quotations and references are machine-extracted, not authenticated originals.',
      'Same record identifiers do not prove matching billing periods, process stages or authorized revisions.',
    ]
    if (citedSources < 2) notes.push('Fewer than two separately extracted sources cite this finding.')
    if (!finding.compared.length) notes.push('No literal field-value comparison was independently checked in this summary.')
    return { id: finding.id, title: finding.title, citedSources, citedExcerpts: finding.citations.length,
      level: citedSources < 2 ? 'Insufficient source coverage' as const : 'Source-linked; context unverified' as const,
      notes }
  })
  const coveredSourceCount = sources.filter(s => s.citedExcerpts > 0).length
  return { sources, findings, coveredSourceCount, totalSourceCount: sources.length,
    warnings: [
      'Evidence quality labels describe extracted coverage, not probability of fraud or truth.',
      'The original records, signatures, versions and external corroboration have not been authenticated.',
      ...(sources.some(s => s.level !== 'Readable excerpts') ? ['One or more documents require manual source-quality review.'] : []),
    ] }
}
