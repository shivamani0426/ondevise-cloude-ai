import type { CaseFinding, EvidenceDocument } from './core'
import { makeStructuredClaim, compareClaimContext } from './claims.ts'
import type { Compatibility, StructuredClaim } from './claims.ts'

// Domain-neutral evidence linking. This works on local extracted source text,
// not filenames, external services, or model-generated interpretations.
// Equal reference strings verify a text match ONLY, not authenticity, identity,
// fraud, legal validity, or that two documents refer to the same real event.
type Field = { key: string; value: string; ref: string; docId: string }
type Identifier = { value: string; family: string; ref: string; docId: string }
type RecordData = { document: EvidenceDocument; identifiers: Identifier[]; fields: Field[] }
const unique = <T,>(values: T[]): T[] => [...new Set(values)]

const identityFamilies = [
  'invoice', 'order', 'transaction', 'payment', 'receipt', 'contract', 'agreement',
  'shipment', 'tracking', 'booking', 'reservation', 'claim', 'case', 'policy',
  'application', 'reference', 'ticket',
]
const genericFamilies = new Set(['reference'])
const idSuffix = /(?:^|_)(?:id|number|no|ref|reference|code)$/
const ignoredValues = /^(?:null|none|unknown|n\/a|pending|not|unspecified)$/i
const badField = /(^|_)(?:id|no|number|reference|ref|code|secret|password|token|api|key|name|address|email|phone|notes?|comments?|description|memo|url|link)($|_)/
const trimValue = (s: string) => s.trim().replace(/^["'[{(]+|["'\s,;.)}\]]+$/g, '')
const fieldKey = (raw: string) => raw.trim().replace(/([a-z])([A-Z])/g, '$1_$2')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
// Explicit synonyms only; preserve currency, period, stage and charge scope.
const canonicalField = (raw: string): string => {
  const key = fieldKey(raw)
  const aliases: Record<string, string> = {
    date_of_issue: 'issue_date', date_of_expiry: 'expiry_date',
    date_of_activation: 'activation_date', date_of_birth: 'birth_date',
    claim_amount: 'claimed_amount', invoice_total: 'total_invoice_amount',
  }
  const match = key.match(/^(.*?)(_usd|_inr|_eur|_gbp)$/)
  const root = match ? match[1] : key
  return (aliases[root] || root) + (match?.[2] || '')
}
const familyOf = (label: string): string | null => {
  const words = fieldKey(label).split('_').filter(Boolean)
  const family = words.find(word => identityFamilies.includes(word))
  if (!family) return null
  // A plain "status" or "amount" never establishes a record reference.
  const identifierLabel = words.length === 1 || words.some(word => idSuffix.test('_' + word))
  return identifierLabel ? family : null
}
function idValue(raw: string): string | null {
  const value = trimValue(raw).toUpperCase().replace(/_/g, '-')
  if (value.length < 6 || value.length > 48 || !/^[A-Z0-9-]+$/.test(value) ||
      !/[A-Z]/.test(value) || !/\d/.test(value) || ignoredValues.test(value)) return null
  // Explicit masking must never be treated as a complete identifier.
  if (/^X{3,}[A-Z0-9-]{4,16}$/.test(value)) return null
  // Don't treat long free text, dates, or raw card/account numbers as IDs.
  if (/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null
  return value
}
function addIdentifier(items: Identifier[], docId: string, ref: string, family: string, raw: string) {
  const value = idValue(raw)
  if (!value || !identityFamilies.includes(family)) return
  if (!items.some(id => id.docId === docId && id.ref === ref && id.value === value && id.family === family)) {
    items.push({ value, family, ref, docId })
  }
}
function addField(fields: Field[], docId: string, ref: string, label: string, raw: string) {
  const key = canonicalField(label)
  const value = trimValue(raw)
  if (!key || key.length > 42 || badField.test(key) || key === 'source' ||
      !value || value.length > 60 || /\n/.test(value) || /^(?:null|none|unknown|n\/a|unspecified)$/i.test(value)) return
  // Only compare short, explicit field values. Entire document paragraphs and
  // unstated contextual claims cannot be converted into exact field facts.
  if (value.split(/\s+/).length > 5) return
  if (!fields.some(field => field.ref === ref && field.key === key && field.value === value)) {
    fields.push({ key, value, ref, docId })
  }
}

// CSV parser preserves quotation marks and commas inside quoted cells; unlike
// naive split(','), it handles the ordinary CSV escaping convention.
function csvCells(line: string): string[] | null {
  const values: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++ }
      else if (!quoted && cell.trim() === '') quoted = true
      else if (quoted) quoted = false
      else return null
    } else if (char === ',' && !quoted) { values.push(cell.trim()); cell = '' }
    else cell += char
  }
  if (quoted) return null
  values.push(cell.trim())
  return values
}

function readRecord(document: EvidenceDocument): RecordData {
  const identifiers: Identifier[] = []
  const fields: Field[] = []
  const sections = document.segments.slice(0, 240)

  if (document.format.toUpperCase() === 'CSV' && sections.length > 1) {
    const headers = csvCells(sections[0].text)
    if (headers && headers.length >= 2 && headers.length <= 48) {
      const keys = headers.map(fieldKey)
      for (const segment of sections.slice(1)) {
        const values = csvCells(segment.text)
        if (!values || values.length !== keys.length) continue
        const ref = document.id + ':' + segment.id
        for (let i = 0; i < keys.length; i++) {
          const family = familyOf(keys[i])
          if (family) addIdentifier(identifiers, document.id, ref, family, values[i])
          else addField(fields, document.id, ref, keys[i], values[i])
        }
      }
    }
  }

  for (const segment of sections) {
    const ref = document.id + ':' + segment.id
    // Handle JSON object properties (including pretty-printed JSON lines),
    // colon-separated TXT/MD and "key=value" fields. Do not infer values
    // from unlabelled prose.
    // Recognize narrowly scoped affirmative narrative facts, not arbitrary prose.
    // A full labelled record ID on the same line is required. Negation, conditions,
    // revisions, and competing references are left for manual review.
    const sentence = segment.text.trim().match(/^(invoice|claim|application|policy|contract|agreement|order|transaction|shipment|case|ticket)\s+(?:ID|number|No\.?|reference)\s*[:#]?\s*([A-Za-z][A-Za-z0-9_-]{5,47})\s+(?:has|records|states)\s+(?:an?\s+)?(issue date|expiry date|activation date|claimed amount|claim amount|invoice total|total invoice amount|amount)\s+of\s+((?:USD|INR|EUR|GBP|[$₹€£])?\s*\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:USD|INR|EUR|GBP))?|\d{4}-\d{2}-\d{2})\.?$/i)
    if (sentence && idValue(sentence[2])) {
      addIdentifier(identifiers, document.id, ref, sentence[1].toLowerCase(), sentence[2])
      addField(fields, document.id, ref, sentence[3], sentence[4])
    }
    const parts = segment.text.split(/[,;]\s*(?=["']?[A-Za-z][\w -]{0,40}["']?\s*[:=])/)
    for (const part of parts) {
      const m = part.trim().match(/^[{(]?\s*["']?([A-Za-z][\w -]{0,42})["']?\s*[:=]\s*(.*)$/)
      if (!m) continue
      const label = m[1]
      const value = m[2].replace(/[}]\s*$/, '')
      const family = familyOf(label)
      if (family) addIdentifier(identifiers, document.id, ref, family, value)
      else addField(fields, document.id, ref, label, value)
    }
    // Ordinary narrative: "Invoice number INV-..."; "Reference: ...";
    // "Shipment ID: ...". Nothing is matched without a recognizable field
    // label and a structured alphanumeric identifier.
    const narrative = /\b(invoice|order|transaction|payment|receipt|contract|agreement|shipment|tracking|booking|reservation|claim|case|policy|application|reference|ticket)\s*(?:id|no\.?|number|ref(?:erence)?|#)?\s*[:#=-]?\s*([A-Za-z][A-Za-z0-9_-]{5,47})\b/gi
    for (const m of segment.text.matchAll(narrative)) {
      addIdentifier(identifiers, document.id, ref, m[1].toLowerCase(), m[2])
    }
  }
  return { document, identifiers: identifiers.slice(0, 75), fields: fields.slice(0, 100) }
}

// Let existing legacy review cues respect unambiguous explicit record IDs too.
// No new ID parser: consume the same locally extracted, source-anchored labels.
export function explicitRecordScopes(documents: EvidenceDocument[]): Array<{
  docId: string; ref: string; family: string; value: string
}> {
  return documents.slice(0, 8).flatMap(document => readRecord(document).identifiers)
}

const compatibleFamily = (a: string, b: string) => a === b || genericFamilies.has(a) || genericFamilies.has(b)

type LinkedGroup = { identifiers: Identifier[]; fields: Field[] }
function linkedGroups(records: RecordData[]): LinkedGroup[] {
  const byValue = new Map<string, Identifier[]>()
  for (const record of records) {
    for (const item of record.identifiers) {
      const group = byValue.get(item.value) || []
      group.push(item)
      byValue.set(item.value, group)
    }
  }
  const groups: LinkedGroup[] = []
  for (const refs of byValue.values()) {
    const ids = unique(refs.map(item => item.docId))
    if (ids.length < 2) continue
    // An untyped "reference" is not evidence that invoice and shipment
    // identifiers with the same literal token describe one shared record.
    const typedFamilies = unique(refs.map(item => item.family).filter(family => !genericFamilies.has(family)))
    if (typedFamilies.length > 1) continue
    // Do not connect a contract ID to a shipment ID just because their
    // strings happen to match. Generic "reference" can link a typed label.
    const compatible = refs.filter(item => refs.some(other =>
      other.docId !== item.docId && compatibleFamily(item.family, other.family)))
    if (new Set(compatible.map(item => item.docId)).size < 2) continue
    const fields: Field[] = []
    for (const record of records) {
      const current = compatible.filter(item => item.docId === record.document.id)
      if (!current.length) continue
      // A field on the same segment/row as an identifier has an unambiguous
      // source. A whole-document field inherits identity ONLY if this
      // document contains exactly one distinct identifier value.
      const soleId = new Set(record.identifiers.map(item => item.value)).size === 1
      for (const field of record.fields) {
        const rowIdentities = unique(record.identifiers
          .filter(item => item.ref === field.ref).map(item => item.value))
        // If the same row/paragraph mentions several record identities,
        // assigning its field to one of them would fabricate a link.
        if (soleId || (rowIdentities.length === 1 &&
          current.some(item => item.ref === field.ref && item.value === rowIdentities[0]))) {
          fields.push(field)
        }
      }
    }
    groups.push({ identifiers: compatible, fields })
  }
  return groups.slice(0, 8)
}

/** Real graph nodes reuse verified, source-anchored textual reference links. */
export function linkedReferenceEntities(documents: EvidenceDocument[]): Array<{ value: string; refs: string[] }> {
  if (documents.length < 2) return []
  return linkedGroups(documents.slice(0, 8).map(readRecord)).map(group => ({
    value: group.identifiers[0].value,
    refs: unique(group.identifiers.map(item => item.ref)),
  }))
}

// Construct claims only for fields securely scoped to a matched reference.
// The parsing and source-linking logic remains in this module: no second parser.
function claimFor(group: LinkedGroup, field: Field): StructuredClaim | null {
  const owner = group.identifiers.find(item => item.docId === field.docId)
  if (!owner) return null
  const ownFields = group.fields.filter(item =>
    item.docId === field.docId && item.ref === field.ref)
  // If a document uses one record ID across several lines, its metadata may
  // appear on a distinct line; only use document-wide metadata if the field's
  // row does not have independent metadata.
  const values = (key: RegExp): string | undefined =>
    ownFields.find(item => key.test(item.key))?.value ||
    group.fields.find(item => item.docId === field.docId && key.test(item.key))?.value
  const context = {
    version: values(/^(?:revision|version|amendment)(?:_number|_no)?$/),
    approval: values(/^(?:signature_status|approval_status|signed|approved)$/),
    condition: values(/^(?:condition|terms_condition|scope)$/),
  }
  return makeStructuredClaim({
    ref: field.ref, sourceId: field.docId,
    family: owner.family, reference: owner.value,
    property: field.key, literal: field.value, context,
  })
}

function nextCheckForClaim(claim: StructuredClaim): string {
  switch (claim.value.kind) {
    case 'date':
      return 'Confirm the applicable date from the original documents, any superseding amendment, signatures and issuer.'
    case 'amount':
      return 'Confirm the same charge or amount, currency, period and authorized adjustments using original records.'
    case 'number':
      return 'Confirm the unit, event stage, counting method and any corrections with the record issuer.'
    case 'status':
      return 'Check the recorded sequence and timestamps of each status; distinguish a transition from conflicting records.'
    case 'version':
      return 'Compare original revisions, approvals and effective periods to determine the governing version.'
    default:
      return 'Verify the field meaning, conditions, applicable scope and corrections in the original records.'
  }
}

type Compared = { a: StructuredClaim; b: StructuredClaim; evaluation: Compatibility }

// A reference equality is a candidate link; only compare claims sharing
// the same field name and compatible source identity. Prefer a genuinely
// comparable changed fact over a routine workflow/status progression.
function compareGroup(group: LinkedGroup, agreementOnly = false): Compared | null {
  const claims = group.fields.map(item => claimFor(group, item))
    .filter((item): item is StructuredClaim => item !== null)
  const options: Compared[] = []
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      if (claims[i].sourceId === claims[j].sourceId ||
          claims[i].property !== claims[j].property) continue
      const evaluation = compareClaimContext(claims[i], claims[j])
      if (agreementOnly ? evaluation.outcome === 'agree' && ['date','amount','number'].includes(claims[i].value.kind) :
          evaluation.outcome === 'different-values' || evaluation.outcome === 'context-dependent') {
        options.push({ a: claims[i], b: claims[j], evaluation })
      }
    }
  }
  if (agreementOnly) return options[0] || null
  return options.find(item => item.evaluation.outcome === 'different-values') ||
    options.find(item => item.evaluation.outcome === 'context-dependent') || null
}

// Explicitly labelled masked identifiers are only candidate review cues.
// Require a unique full identifier of the same family and an exact suffix.
// Do not attach other fields, manufacture graph identity nodes, or treat
// ambiguous or unlabelled matches as evidence of the same record.
function partialReferenceCues(records: RecordData[]): CaseFinding[] {
  const full = records.flatMap(record => record.identifiers)
  const output: CaseFinding[] = []
  const seen = new Set<string>()
  for (const record of records) {
    if (record.document.format.toUpperCase() === 'CSV') continue
    for (const segment of record.document.segments.slice(0, 240)) {
      const match = segment.text.trim().match(/^(invoice|order|transaction|payment|receipt|contract|agreement|shipment|tracking|booking|reservation|claim|case|policy|application|ticket)\s+(?:ID|number|No\.?|reference)\s*(?:[:#]\s*)?(?:ending in\s+|\*{3,}|X{3,})([A-Z0-9-]{4,16})\.?$/i)
      if (!match) continue
      const family = match[1].toLowerCase()
      const suffix = match[2].toUpperCase()
      if (!/\d/.test(suffix)) continue
      // A second complete reference in the partial source may refer to
      // another record; leave it for a human instead of guessing.
      if (record.identifiers.length) continue
      const compatible = full.filter(id => id.docId !== record.document.id &&
        id.family === family && id.value.endsWith(suffix) && id.value.length > suffix.length)
      if (new Set(compatible.map(id => id.value)).size !== 1) continue
      const target = compatible[0]
      const ref = record.document.id + ':' + segment.id
      const key = ref + ':' + target.value
      if (seen.has(key)) continue
      seen.add(key)
      output.push({
        id: 'partial-reference-' + output.length,
        title: 'Incomplete reference needs verification',
        status: 'Unverified hypothesis',
        detail: 'A source explicitly states an incomplete record reference that matches the ending of one full reference among the supplied documents. This is a candidate only, not a confirmed record relationship.',
        nextStep: 'Obtain the complete identifier from the issuer and verify the record independently before comparing any fields.',
        refs: [ref, target.ref], origin: 'rules',
        explanation: {
          basis: 'An explicitly labelled partial identifier and a full identifier of the same record type share an exact ending.',
          context: 'Only one matching full reference was found in the supplied sources. Other records not supplied may share the same ending. No field values were compared.',
          limitation: 'A partial identifier cannot establish record identity, authenticity or fraud.',
        },
      })
      if (output.length >= 3) return output
    }
  }
  return output
}

/** A linked identity is a *matching token* with source anchors, not a real-world verification. */
export function relateEvidence(documents: EvidenceDocument[]): CaseFinding[] {
  if (documents.length < 2) return []
  const records = documents.slice(0, 8).map(readRecord)
  const groups = linkedGroups(records)
  const results: CaseFinding[] = []

  for (const group of groups) {
    if (results.length >= 5) break
    const matchingSources = unique(group.identifiers.map(item => item.docId))
    const ids = unique(group.identifiers.map(item => item.ref))
    const selected = compareGroup(group)
    const agreement = selected ? null : compareGroup(group, true)
    const pair = selected || agreement
    const refs = pair
      ? unique([...ids.slice(0, 8), pair.a.ref, pair.b.ref])
      : ids.slice(0, 10)
    if (refs.length < 2) continue
    if (selected) {
      const { a, b, evaluation } = selected
      const changed = evaluation.outcome === 'context-dependent'
      results.push({
        id: 'relationship-' + results.length,
        title: changed
          ? 'Same reference, context-dependent recorded change'
          : 'Same reference, different recorded field values',
        status: changed ? 'Unverified hypothesis' : 'Possible concern',
        detail: 'An identical structured reference appears across ' +
          matchingSources.length + ' documents. ' + evaluation.basis + ' ' +
          (changed ? 'The change may reflect a normal progression or revision.' :
            'The discrepancy needs reconciliation, not a fraud determination.'),
        nextStep: nextCheckForClaim(a),
        refs, origin: 'rules',
        explanation: {
          basis: evaluation.basis,
          context: evaluation.context,
          limitation: evaluation.limitation,
          compared: [
            { ref: a.ref, field: a.property.replace(/_/g, ' '), value: a.value.literal },
            { ref: b.ref, field: b.property.replace(/_/g, ' '), value: b.value.literal },
          ],
        },
      })
    } else {
      results.push({
        id: 'relationship-' + results.length,
        title: 'Shared structured reference across documents',
        status: 'Unverified hypothesis',
        detail: 'The same explicitly labelled alphanumeric reference appears in ' +
          matchingSources.length + ' distinct sources. Matching text alone does not prove common ownership, authenticity or that every claim describes the same event.',
        nextStep: 'Compare the complete referenced records, parties and dates using independently obtained originals. Do not infer a fraudulent link from a matching ID alone.',
        refs, origin: 'rules',
        explanation: {
          basis: 'The extracted documents contain matching, explicitly labelled record identifiers.',
          context: agreement ? 'At least one comparable field agrees in the extracted text. Other fields may be untested or incomplete; this does not authenticate the records.' : 'No compatible, differing field values were established for this shared reference. Different process stages, currencies and unparseable fields are not treated as contradictions.',
          ...(agreement ? { agreement: [agreement.a, agreement.b].map(claim => ({ ref: claim.ref, field: claim.property.replace(/_/g, ' '), value: claim.value.literal })) } : {}),
          limitation: 'The linked records may still concern different real-world parties or events; original documents and issuer confirmation are required.',
        },
      })
    }
  }
  return [...results, ...partialReferenceCues(records)].slice(0, 5)
}
