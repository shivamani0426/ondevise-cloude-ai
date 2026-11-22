import type { CaseFinding, EvidenceDocument } from './core'

// Deterministic evidence reconciliation. Everything is derived from exact local
// source segments, not from an external model or a particular test filename.
// Claims with unclear identity, scope or stage are REVIEW CUES, never verdicts.
type Hit = { ref: string; sourceId: string; text: string }
type QuantityClaim = Hit & { stage: 'shipped' | 'delivered' | 'received'; amount: number; unit: string; shipmentIds: string[] }
type TermClaim = Hit & { topic: string; value: string; unit?: string }
const safeUnique = (items: string[]) => [...new Set(items)]
const tokens = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const shipmentIdPattern = /\b[A-Z]{2,12}[-_]\d{4}[-_]\d{2,10}\b/gi
const normalizeUnit = (unit: string) => /^(?:units?|pieces?|items?|pcs)$/i.test(unit) ? 'units' :
  /^(?:boxes|cartons|packages?)$/i.test(unit) ? 'packages' : unit.toLowerCase()

function add(findings: CaseFinding[], title: string, detail: string, nextStep: string, references: string[]) {
  const refs = safeUnique(references).slice(0, 8)
  if (refs.length < 2 || findings.length >= 8) return
  findings.push({
    id: 'reconcile-' + findings.length, title, detail, nextStep,
    refs, origin: 'rules', status: 'Possible concern',
  })
}

function hits(documents: EvidenceDocument[]): Hit[] {
  const result: Hit[] = []
  for (const doc of documents.slice(0, 8)) {
    for (const segment of doc.segments.slice(0, 240)) {
      if (segment.text.trim() && !/^\[No (?:readable|extractable)/i.test(segment.text)) {
        result.push({ sourceId: doc.id, ref: doc.id + ':' + segment.id, text: segment.text })
      }
    }
  }
  return result
}

function docReferenceIds(document: EvidenceDocument): string[] {
  const found = document.segments.flatMap(s => [...s.text.matchAll(shipmentIdPattern)].map(m => m[0].toUpperCase().replace(/_/g, '-')))
  return safeUnique(found)
}
function compatibleIdentity(a: QuantityClaim, b: QuantityClaim): boolean {
  if (!a.shipmentIds.length && !b.shipmentIds.length) return true
  if (a.shipmentIds.length && b.shipmentIds.length) return a.shipmentIds.some(id => b.shipmentIds.includes(id))
  // Only one side named a shipment: context is uncertain, never claim a
  // confirmed discrepancy and avoid matching multiple unrelated sources.
  return true
}

function quantities(documents: EvidenceDocument[]): QuantityClaim[] {
  const result: QuantityClaim[] = []
  for (const doc of documents) {
    const shipmentIds = docReferenceIds(doc)
    for (const s of doc.segments) {
      // E.g. "120 units shipped", "received 96 units", or "delivered_units": 96.
      const candidates: { amount: number; stage: QuantityClaim['stage']; unit: string }[] = []
      const x = /(\d[\d,]*)\s*(units?|items?|pieces?|pcs|packages?|boxes|cartons)\s*(?:were\s+|has been\s+)?(shipped|dispatched|sent|delivered|received)\b/gi
      for (const m of s.text.matchAll(x)) candidates.push({
        amount: Number(m[1].replace(/,/g, '')), unit: normalizeUnit(m[2]),
        stage: /shipped|dispatched|sent/i.test(m[3]) ? 'shipped' : /delivered/i.test(m[3]) ? 'delivered' : 'received',
      })
      const y = /\b(shipped|dispatched|sent|delivered|received)[\s_-]*(units?|items?|pieces?|pcs|packages?|boxes|cartons)?\s*["']?\s*[:=]?\s*(\d[\d,]*)\s*(units?|items?|pieces?|pcs|packages?|boxes|cartons)?\b/gi
      for (const m of s.text.matchAll(y)) candidates.push({
        amount: Number(m[3].replace(/,/g, '')), unit: normalizeUnit(m[2] || m[4] || 'units'),
        stage: /shipped|dispatched|sent/i.test(m[1]) ? 'shipped' : /delivered/i.test(m[1]) ? 'delivered' : 'received',
      })
      const z = /\b(shipped|dispatched|sent|delivered|received)\s+(?:quantity|count)\s+(?:is|of|:|=)\s*(\d[\d,]*)\s*(units?|items?|pieces?|pcs|packages?|boxes|cartons)\b/gi
      for (const m of s.text.matchAll(z)) candidates.push({
        amount: Number(m[2].replace(/,/g, '')), unit: normalizeUnit(m[3]),
        stage: /shipped|dispatched|sent/i.test(m[1]) ? 'shipped' : /delivered/i.test(m[1]) ? 'delivered' : 'received',
      })
      for (const candidate of candidates) {
        if (!Number.isSafeInteger(candidate.amount) || candidate.amount < 1 || candidate.amount > 100000000) continue
        if (result.some(existing => existing.ref === doc.id + ':' + s.id && existing.stage === candidate.stage && existing.amount === candidate.amount)) continue
        result.push({ sourceId: doc.id, ref: doc.id + ':' + s.id, text: s.text, shipmentIds, ...candidate })
      }
    }
  }
  return result.slice(0, 80)
}

function cancellationTerms(h: Hit): TermClaim[] {
  // Cancellation/refund/return windows can be in prose or a named field.
  const terms: TermClaim[] = []
  if (!/\b(cancel(?:lation|led|ling)?|refund(?:able|s)?|return(?:s|ed)?)\b/i.test(h.text)) return terms
  const re = /\b(?:within|after|before|up to|period of|window of)\s*(\d{1,4})\s*(calendar|business)?\s*(days?|weeks?|months?)\b/gi
  for (const m of h.text.matchAll(re)) {
    const unit = (m[2] || 'calendar').toLowerCase() + ' ' + m[3].toLowerCase().replace(/s$/, '')
    terms.push({ ...h, topic: 'cancellation-window', value: String(Number(m[1])), unit })
  }
  return terms
}

function activationTerms(h: Hit): TermClaim[] {
  const result: TermClaim[] = []
  if (!/\b(?:activat(?:ion|es?|ed)|effective date|commencement)\b/i.test(h.text)) return result
  // Exclude invoice due_date/dated statements: don't compare a fee due date
  // against an activation date.
  const re = /(?:\bactivat(?:ion|es?|ed)\b|\beffective date\b|\bcommencement\b)[^\n.]{0,60}?\b(20\d{2}-\d{2}-\d{2})\b/gi
  for (const m of h.text.matchAll(re)) {
    result.push({ ...h, topic: 'activation-date', value: m[1] })
  }
  return result
}

function feeMentions(h: Hit): Array<TermClaim & { polarity: 'waived' | 'charged' }> {
  const out: Array<TermClaim & { polarity: 'waived' | 'charged' }> = []
  // A topic is a short label immediately preceding "fee", "charge" or
  // "deposit". These are linguistic units, not hardcoded company/offer facts.
  const re = /\b([a-z][a-z-]{2,30})\s+(fees?|charges?|deposits?)\b/gi
  for (const m of h.text.matchAll(re)) {
    const topic = tokens(m[1] + ' ' + m[2].replace(/s$/, ''))
    if (/^(?:no|any|the|this|those|some|each|other|such|that|these|paid|free)\b/.test(topic)) continue
    const before = h.text.slice(Math.max(0, m.index - 42), m.index)
    const after = h.text.slice(m.index + m[0].length, m.index + m[0].length + 45)
    const surrounding = before + ' ' + m[0] + after
    const waived = /(?:\bno\b|\bwithout\b|\bwaived\b|\bfree from\b|\bnot (?:required|due|applicable|payable)\b)/i.test(surrounding)
    const charged = /(?:\b(?:USD|INR|Rs\.?|EUR|GBP)\s*\d|\b[$₹€£]\s*\d|\b(?:required|due|payable|charged|billed|applies|incurs)\b|\b\d+(?:\.\d+)?\b)/i.test(surrounding)
    if (waived || charged) out.push({ ...h, topic, value: 'fee policy', polarity: waived ? 'waived' : 'charged' })
  }
  return out
}

export function compareDocumentClaims(documents: EvidenceDocument[]): CaseFinding[] {
  if (documents.length < 2) return []
  const findings: CaseFinding[] = []
  const evidence = hits(documents)

  // Compare the same quantity unit at different logistics stages. A quantity
  // mismatch is NOT proof of a shortage, loss, theft or fraudulent activity.
  const q = quantities(documents)
  const sent = q.filter(x => x.stage === 'shipped')
  const received = q.filter(x => x.stage === 'received' || x.stage === 'delivered')
  const quantityPairs = sent.flatMap(a => received
    .filter(b => a.sourceId !== b.sourceId && a.unit === b.unit && a.amount !== b.amount && compatibleIdentity(a, b))
    .map(b => ({ a, b })))
  if (quantityPairs.length) {
    const one = quantityPairs[0]
    // If one side lacks an identifier, we flag uncertainty rather than
    // claiming the shipments are the same.
    const allRef = quantityPairs.slice(0, 4).flatMap(p => [p.a.ref, p.b.ref])
    add(findings, 'Quantities at different process stages need reconciliation',
      'The extracted sources record ' + one.a.amount + ' ' + one.a.unit + ' dispatched and ' +
        one.b.amount + ' ' + one.b.unit + ' delivered/received. These are different process stages; ' +
        'the difference is not independently verified as missing goods.',
      'Confirm matching shipment/item identity and whether delivery is partial, pending, damaged, returned, or revised.',
      allRef)
  }

  // If the same policy/topic has different numerical windows, review possible
  // updates, scope and approvals instead of asserting legal effect.
  const cancellation = evidence.flatMap(cancellationTerms)
  const cancelPairs = cancellation.flatMap((a, i) => cancellation.slice(i+1)
    .filter(b => a.sourceId !== b.sourceId && a.value !== b.value && a.unit === b.unit).map(b => [a, b]))
  if (cancelPairs.length) add(findings, 'Different cancellation or refund windows across sources',
    'Different time windows are mentioned for a comparable cancellation/refund term. Later revisions, conditions and signature status may determine which applies.',
    'Review full clauses, effective dates, approval/signature status and any superseding amendments.',
    cancelPairs.slice(0,4).flatMap(pair => pair.map(x => x.ref)))

  const activation = evidence.flatMap(activationTerms)
  const activationPairs = activation.flatMap((a, i) => activation.slice(i+1)
    .filter(b => a.sourceId !== b.sourceId && a.value !== b.value).map(b => [a, b]))
  if (activationPairs.length) add(findings, 'Different activation or effective dates across sources',
    'Different sources contain distinct activation/effective dates. This may reflect a proposed or approved revision, not an established contradiction.',
    'Check which document is signed and effective. Do not compare invoice due dates with service activation dates.',
    activationPairs.slice(0,4).flatMap(pair => pair.map(x => x.ref)))

  const fees = evidence.flatMap(feeMentions)
  const feePairs = fees.flatMap((a,i) => fees.slice(i+1)
    .filter(b => a.sourceId !== b.sourceId && a.topic === b.topic && a.polarity !== b.polarity)
    .map(b => [a,b]))
  if (feePairs.length) add(findings, 'Fee policy and billing need reconciliation',
    'A source appears to waive a named fee while another discusses charging that same fee. A later approved change or invoice context could explain this.',
    'Review the cited fee clauses, invoice line, signatures and any written approval before treating the charge as valid.',
    feePairs.slice(0,4).flatMap(pair => pair.map(x => x.ref)))

  // Never infer contractual validity or fraud from file names or signatures.
  // A pending approval is a separate caution when documents indicate a change.
  const pending = evidence.filter(h => /(?:signature status|signatures?|approval status|approval)\s*[:\-]?\s*(?:pending|unsigned|awaiting|incomplete)\b|\b(?:only if|unless)\s+signed\b/i.test(h.text))
  if (pending.length && findings.some(f => /windows|dates|fee policy/i.test(f.title))) {
    findings.push({ id:'reconcile-'+findings.length, title: 'Approval or signature status needs review',
      status:'Possible concern', origin:'rules',
      detail:'A cited source refers to pending approval/signature or a signing condition. This does not establish whether any change is legally effective.',
      nextStep:'Verify the executed original and amendments with the parties before relying on changed terms.',
      refs: safeUnique(pending.map(h=>h.ref)).slice(0,8) })
  }
  return findings.slice(0, 8)
}
