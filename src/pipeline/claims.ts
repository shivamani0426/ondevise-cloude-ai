// Pipeline 7A/7B: compact, deterministic, fraud-category-neutral claim model.
// Claims derive ONLY from fields already matched to a source-linked record.
// Never turn a text match into a verified real-world identity or fraud verdict.

export type ClaimValueKind = 'date' | 'amount' | 'number' | 'status' | 'version' | 'text' | 'unclear'
export type ClaimContext = {
  version?: string
  approval?: string
  condition?: string
}
export type StructuredClaim = {
  ref: string
  sourceId: string
  subject: { family: string; reference: string }
  property: string
  value: { literal: string; normalized: string; kind: ClaimValueKind; currency?: string }
  context: ClaimContext
}
export type ClaimInput = {
  ref: string
  sourceId: string
  family: string
  reference: string
  property: string
  literal: string
  context?: ClaimContext
}
export type Compatibility = {
  outcome: 'agree' | 'different-values' | 'context-dependent' | 'incomparable'
  basis: string
  context: string
  limitation: string
}

const normalized = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')
const safeDate = (text: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const [year, month, day] = text.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day ? text : null
}
const currencyFrom = (token: string): string | undefined => {
  const t = token.toUpperCase()
  return ({ '$': 'USD', '₹': 'INR', '€': 'EUR', '£': 'GBP' } as Record<string, string>)[t] ||
    (['USD','INR','EUR','GBP'].includes(t) ? t : undefined)
}
function classifyValue(property: string, literal: string): StructuredClaim['value'] {
  const raw = literal.trim()
  const key = property.toLowerCase()
  if (/(?:^|_)(?:date|on_date)$/.test(key) || /^(?:effective|activation|commencement)_date$/.test(key)) {
    const date = safeDate(raw)
    return { literal: raw, normalized: date || raw, kind: date ? 'date' : 'unclear' }
  }
  if (/(?:^|_)(?:status|state)$/.test(key) || /^(?:signed|approved|approval|signature)$/.test(key)) {
    return { literal: raw, normalized: normalized(raw), kind: 'status' }
  }
  if (/^(?:version|revision|amendment)(?:_number|_no)?$/.test(key)) {
    return { literal: raw, normalized: normalized(raw), kind: 'version' }
  }
  // Currency codes are accepted ONLY when clearly attached to the value or
  // field name; a bare amount in one source is not silently assumed to be USD.
  const fieldCurrency = currencyFrom(key.split('_').at(-1) || '')
  const match = raw.match(/^(?:(USD|INR|EUR|GBP|[$₹€£])\s*)?(-?\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(USD|INR|EUR|GBP))?$/i)
  if (match) {
    const explicitCurrency = currencyFrom(match[1] || match[3] || '')
    if (explicitCurrency && fieldCurrency && explicitCurrency !== fieldCurrency) {
      return { literal: raw, normalized: raw, kind: 'unclear' }
    }
    const numeric = Number(match[2].replace(/,/g, ''))
    if (!Number.isFinite(numeric)) return { literal: raw, normalized: raw, kind: 'unclear' }
    const currency = explicitCurrency || fieldCurrency
    return {
      literal: raw,
      normalized: String(numeric),
      kind: currency || /(?:^|_)(?:amount|price|total|fee|charge|cost|balance|salary|payment)(?:_|$)/.test(key)
        ? 'amount' : 'number',
      ...(currency ? { currency } : {}),
    }
  }
  if (/(?:^|_)(?:amount|price|total|fee|charge|cost|balance)$/.test(key)) {
    return { literal: raw, normalized: normalized(raw), kind: 'unclear' }
  }
  return { literal: raw, normalized: normalized(raw), kind: 'text' }
}

export function makeStructuredClaim(input: ClaimInput): StructuredClaim {
  return {
    ref: input.ref,
    sourceId: input.sourceId,
    subject: { family: input.family, reference: input.reference },
    property: input.property,
    value: classifyValue(input.property, input.literal),
    context: { ...(input.context || {}) },
  }
}

const caution = 'A matching reference or extracted value does not authenticate a record, determine legal effect, or prove fraudulent conduct.'
export function compareClaimContext(a: StructuredClaim, b: StructuredClaim): Compatibility {
  const fail = (reason: string): Compatibility => ({
    outcome: 'incomparable',
    basis: 'These claims cannot be safely compared as the same fact.',
    context: reason, limitation: caution,
  })
  if (a.sourceId === b.sourceId) return fail('Both claims come from one source, not independent records.')
  if (a.subject.reference !== b.subject.reference ||
      (a.subject.family !== b.subject.family &&
       a.subject.family !== 'reference' && b.subject.family !== 'reference')) {
    return fail('The records do not have compatible explicitly labelled identities.')
  }
  if (a.property !== b.property) return fail('The claims describe different named fields or process stages.')
  if (a.value.kind === 'unclear' || b.value.kind === 'unclear' || a.value.kind !== b.value.kind) {
    return fail('The extracted values have incompatible or unrecognized types; inspect original formatting.')
  }
  if (a.value.currency !== b.value.currency) {
    return fail('The amounts do not have the same explicit currency, or one currency is unknown.')
  }
  const field = a.property.replace(/_/g, ' ').slice(0, 42)
  const same = a.value.normalized === b.value.normalized
  const base = 'The same explicitly labelled field "' + field +
    '" is associated with the same alphanumeric record reference in two source documents.'
  const versionChanged = a.context.version && b.context.version &&
    normalized(a.context.version) !== normalized(b.context.version)
  const approvalUnknown = [a.context.approval, b.context.approval].some(s =>
    s && /\b(?:pending|unsigned|draft|unapproved|awaiting|conditional|proposed)\b/i.test(s))
  const conditionChanged = a.context.condition && b.context.condition &&
    normalized(a.context.condition) !== normalized(b.context.condition)

  if (same) return {
    outcome: 'agree', basis: base,
    context: 'The extracted field values agree. That does not independently confirm their accuracy.',
    limitation: caution,
  }
  if (a.value.kind === 'status' || a.value.kind === 'version' ||
      versionChanged || approvalUnknown || conditionChanged) {
    const reasons = [
      a.value.kind === 'status' ? 'The value is a status that may change over time.' : '',
      a.value.kind === 'version' || versionChanged ? 'Different record versions may supersede earlier values.' : '',
      approvalUnknown ? 'Approval or signature context is incomplete or pending.' : '',
      conditionChanged ? 'The stated conditions differ.' : '',
    ].filter(Boolean)
    return {
      outcome: 'context-dependent',
      basis: base + ' The extracted values differ.',
      context: reasons.join(' ') + ' Verify the record timeline and which version applies.',
      limitation: caution,
    }
  }
  return {
    outcome: 'different-values',
    basis: base + ' Its extracted values differ.',
    context: 'The values are comparable in field type and, where available, currency. Verify any scope, conditions, corrections and effective dates before treating this as a contradiction.',
    limitation: caution,
  }
}
