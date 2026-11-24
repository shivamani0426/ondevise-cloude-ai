import type { Investigation, CaseFinding } from './core.ts'

// Pipeline 9: deterministic local synthesis. No generative model or network route.
export type SummaryFinding = {
  id: string
  title: string
  status: CaseFinding['status']
  explanation: string
  context: string
  nextStep: string
  compared: { ref: string; field: string; value: string }[]
  citations: { ref: string; anchor: string; documentId: string }[]
}
export type InvestigationSummary = {
  sourceCount: number
  entityCount: number
  ruleFindingCount: number
  aiEvidenceGroupCount: number
  status: 'Review required' | 'No rule-based concern detected'
  overview: string
  findings: SummaryFinding[]
  limitations: string[]
}

export function buildInvestigationSummary(investigation: Investigation): InvestigationSummary {
  const index = new Map<string, { anchor: string; documentId: string; text: string }>()
  for (const document of investigation.documents) {
    for (const segment of document.segments) {
      index.set(document.id + ':' + segment.id, { anchor: segment.anchor, documentId: document.id, text: segment.text })
    }
  }
  const findings: SummaryFinding[] = []
  for (const finding of investigation.findings) {
    // AI output may select quotations, but cannot create a new verified case-level claim.
    if (finding.origin !== 'rules') continue
    const citations = [...new Set(finding.refs)].flatMap(ref => {
      const source = index.get(ref)
      return source ? [{ ref, anchor: source.anchor, documentId: source.documentId }] : []
    })
    if (!citations.length) continue
    // Compared values must actually appear in the cited extracted segment.
    const compared = (finding.explanation?.compared || []).filter(claim =>
      citations.some(citation => citation.ref === claim.ref) &&
      Boolean(claim.value.trim()) &&
      Boolean(index.get(claim.ref)?.text.includes(claim.value))
    )
    findings.push({
      id: finding.id,
      title: finding.title,
      status: finding.status,
      explanation: finding.explanation?.basis || finding.detail,
      context: finding.explanation?.context ||
        'Review the source excerpts and record context before deciding whether the observations concern the same event.',
      nextStep: finding.nextStep,
      compared,
      citations,
    })
  }
  const sourceCount = investigation.documents.length
  const ruleFindingCount = findings.length
  return {
    sourceCount,
    entityCount: investigation.entities.length,
    ruleFindingCount,
    aiEvidenceGroupCount: investigation.findings.filter(item => item.origin !== 'rules').length,
    status: ruleFindingCount ? 'Review required' : 'No rule-based concern detected',
    overview: sourceCount + ' locally extracted source' + (sourceCount === 1 ? ' was' : 's were') +
      ' examined. ' + ruleFindingCount + ' source-linked rule finding' +
      (ruleFindingCount === 1 ? ' requires' : 's require') +
      (ruleFindingCount ? ' human reconciliation.' : ' no reconciliation based on the currently detected rules. This is not proof that the records are accurate or complete.'),
    findings,
    limitations: [
      'An extracted quotation is not independent verification of document authenticity.',
      'Matching references do not establish the same underlying transaction, event, period, or legal obligation.',
      'AI-selected evidence groups are review aids, not additional corroborated discrepancies.',
      'Extraction may miss layout, tables, signatures, handwriting, amendments, and relevant context.',
      'No fraud, wrongdoing, or legal conclusion is established by this summary.',
    ],
  }
}
