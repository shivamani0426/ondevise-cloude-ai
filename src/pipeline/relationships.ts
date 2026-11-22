import type { CaseFinding, EvidenceDocument } from './core'

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
  const key = fieldKey(label)
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

const compatibleFamily = (a: string, b: string) => a === b || genericFamilies.has(a) || genericFamilies.has(b)
const sameValue = (a: string, b: string): boolean => {
  const x = a.trim().toLowerCase().replace(/[\s,]+/g, '')
  const y = b.trim().toLowerCase().replace(/[\s,]+/g, '')
  return x === y
}

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
    // Compare only fields with identical semantic labels, rather than
    // guessing that an invoice due date is an activation date or that shipped
    // and delivered quantities are interchangeable.
    const keys = unique(group.fields.map(item => item.key))
    let pair: [Field, Field] | undefined
    for (const key of keys) {
      const values = group.fields.filter(item => item.key === key)
      const differing = values.find(a => values.some(b =>
        a.docId !== b.docId && !sameValue(a.value, b.value)))
      const other = differing && values.find(b => b.docId !== differing.docId &&
        !sameValue(differing.value, b.value))
      if (differing && other) { pair = [differing, other]; break }
    }
    const refs = pair
      ? unique([...ids, pair[0].ref, pair[1].ref]).slice(0, 10)
      : ids.slice(0, 10)
    if (refs.length < 2) continue
    if (pair) {
      results.push({
        id: 'relationship-' + results.length,
        title: 'Same reference, different recorded field values',
        status: 'Possible concern',
        detail: 'An identical structured reference appears across ' + matchingSources.length +
          ' documents, but the explicitly labelled field "' +
          pair[0].key.replace(/_/g, ' ').slice(0, 42) +
          '" has different extracted values. This does not establish deception; records may be updated, provisional, or refer to different stages.',
        nextStep: 'Verify the original identifiers, subject, record versions, dates, field definitions and approvals before deciding whether the difference is meaningful.',
        refs, origin: 'rules',
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
      })
    }
  }
  return results
}
