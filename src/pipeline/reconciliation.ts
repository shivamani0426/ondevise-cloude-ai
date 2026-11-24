import type { Investigation } from './core.ts'
import { findSource } from './core.ts'

export type ReviewDecision = 'unresolved' | 'explained' | 'verified' | 'dismissed'
export type ReviewEvent = {
  sequence: number
  findingId: string
  decision: ReviewDecision
  reason: string
  recordedAt: string
  sourceRefs: string[]
}
const permitted: ReviewDecision[] = ['unresolved','explained','verified','dismissed']

/** Pipeline 11: explicit, locally held investigator decisions; never automatic case judgments. */
export function recordReview(
  investigation: Investigation,
  history: ReviewEvent[],
  findingId: string,
  decision: ReviewDecision,
  reason: string,
  at = new Date().toISOString(),
): ReviewEvent[] {
  const finding = investigation.findings.find(f => f.id === findingId && f.origin === 'rules')
  if (!finding) throw new Error('Select a current rule-based finding before recording a decision.')
  if (!permitted.includes(decision)) throw new Error('Unknown investigator decision.')
  const note = reason.trim()
  if (note.length < 12 || note.length > 500) throw new Error('Explain the decision in 12–500 characters.')
  if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid audit timestamp.')
  const refs = [...new Set(finding.refs)].filter(ref => Boolean(findSource(investigation.documents, ref)))
  if (!refs.length) throw new Error('The finding has no source-backed citations.')
  return [...history, { sequence: history.length + 1, findingId, decision, reason: note,
    recordedAt: at, sourceRefs: refs }]
}

export function currentReviews(investigation: Investigation, history: ReviewEvent[]): ReviewEvent[] {
  const valid = new Set(investigation.findings.filter(f=>f.origin==='rules').map(f=>f.id))
  const latest = new Map<string, ReviewEvent>()
  for (const event of history) if (valid.has(event.findingId)) latest.set(event.findingId, event)
  return [...latest.values()].sort((a,b)=>a.sequence-b.sequence)
}

export function explainDecision(decision: ReviewDecision): string {
  switch (decision) {
    case 'verified': return 'Investigator-marked externally verified; PhantomGraph has not authenticated the originals.'
    case 'dismissed': return 'Investigator-marked dismissed; retain the recorded explanation for review.'
    case 'explained': return 'Investigator supplied an explanation; supporting original records still require inspection.'
    default: return 'The finding remains unresolved pending original-source verification.'
  }
}
