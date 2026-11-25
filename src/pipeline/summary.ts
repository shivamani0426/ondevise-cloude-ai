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
  agreement: { ref: string; field: string; value: string }[]
  citations: { ref: string; anchor: string; documentId: string }[]
}
export type InvestigationSummary = {
  sourceCount: number
  entityCount: number
  ruleFindingCount: number
  aiEvidenceGroupCount: number
  status: 'Review required' | 'No rule-based concern detected' | 'Matching details found' | 'More information needed'
  outcome: 'difference' | 'matching' | 'uncertain' | 'none'
  concernCount: number
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
    // The analysis engine emits a source-linked "no match" informational
    // fallback. It is not a concern and must never increase concern counts.
    if (finding.title === 'No rule-matched concern found' &&
        finding.status === 'Insufficient evidence') continue
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
    const agreement = (finding.explanation?.agreement || []).filter(claim =>
      citations.some(citation => citation.ref === claim.ref) && Boolean(claim.value.trim()) &&
      Boolean(index.get(claim.ref)?.text.includes(claim.value)))
    findings.push({
      id: finding.id,
      title: finding.title,
      status: finding.status,
      explanation: finding.explanation?.basis || finding.detail,
      context: finding.explanation?.context ||
        'Review the source excerpts and record context before deciding whether the observations concern the same event.',
      nextStep: finding.nextStep,
      compared,
      agreement,
      citations,
    })
  }
  const sourceCount = investigation.documents.length
  const ruleFindingCount = findings.length
  const concernCount = findings.filter(item => item.status === 'Possible concern' || item.status === 'Corroborated conflict').length
  const matching = (item: SummaryFinding) => item.title === 'Shared structured reference across documents' && item.agreement.length === 2 && new Set(item.agreement.map(claim => claim.ref.split(':')[0])).size === 2
  const outcome = concernCount ? 'difference' : findings.some(item => !matching(item)) ? 'uncertain' : findings.length ? 'matching' : 'none'
  return {
    outcome, concernCount,
    sourceCount,
    entityCount: investigation.entities.length,
    ruleFindingCount,
    aiEvidenceGroupCount: investigation.findings.filter(item => item.origin !== 'rules').length,
    status: outcome === 'difference' ? 'Review required' : outcome === 'matching' ? 'Matching details found' : outcome === 'uncertain' ? 'More information needed' : 'No rule-based concern detected',
    overview: sourceCount + ' source(s) checked. ' + (
      outcome === 'difference' ? concernCount + ' potential difference(s) need checking. This is not a fraud determination.' :
      outcome === 'matching' ? 'Some comparable extracted details agree. This is not proof that the records are accurate or complete.' :
      outcome === 'uncertain' ? 'Some relationships or changes need more context before a conclusion can be drawn.' :
      'No discrepancy matched the available checks. This is not proof that the records are accurate or complete.'),
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
