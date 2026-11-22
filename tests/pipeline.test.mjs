import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeEvidence, buildGraph, makeCloudPayload, makeLocalPrompt, findSource, redactForCloud,
  reportInvestigation, validateAIReview, validatePrivacyCandidates, redactWithSuggestions, validateApprovedCloudPayload,
} from '../src/pipeline/core.ts'

const documents = [
  {
    id: 'source-0', name: 'offer.txt', format: 'TXT', size: 100, warnings: [],
    segments: [
      { id: 'a-0', anchor: 'line 1', text: 'Northstar Labs offers a stipend of ₹35,000 per month. Official website northstar.example.' },
      { id: 'a-1', anchor: 'line 2', text: 'No registration or verification fee is required.' },
    ],
  },
  {
    id: 'source-1', name: 'message.txt', format: 'TXT', size: 100, warnings: [],
    segments: [
      { id: 'a-0', anchor: 'line 1', text: 'Please pay ₹2,499 registration verification fee today at northstarr.example.' },
      { id: 'a-1', anchor: 'line 2', text: 'Contact recruiter@example.com or +919876543210 immediately. Password: Abc123SECRET' },
    ],
  },
]

test('analysis uses real source anchors and labels fee/domain/urgency issues cautiously', () => {
  const result = analyzeEvidence(documents)
  assert.equal(result.documents.length, 2)
  assert.ok(result.findings.some(f => /Payment/.test(f.title)))
  assert.ok(result.findings.some(f => /fee statements/.test(f.title)))
  assert.ok(result.findings.some(f => /domains/.test(f.title)))
  assert.ok(result.findings.some(f => /Time-pressure/.test(f.title)))
  for (const finding of result.findings) {
    assert.ok(finding.refs.length)
    assert.notEqual(finding.status, 'Confirmed fraud')
    for (const ref of finding.refs) assert.ok(findSource(documents, ref), 'Invalid evidence reference ' + ref)
  }
  const graph = buildGraph(result)
  assert.ok(graph.nodes.length > result.documents.length)
  for (const edge of graph.edges) {
    assert.ok(graph.nodes.find(node => node.id === edge.from))
    assert.ok(graph.nodes.find(node => node.id === edge.to))
  }
})

test('cloud preview redacts identifiers, never exposes filenames, and retains citation keys', () => {
  const value = makeCloudPayload(documents)
  assert.ok(value.included > 0)
  assert.ok(value.redactions >= 2)
  assert.doesNotMatch(value.payload, /recruiter@example.com/)
  assert.doesNotMatch(value.payload, /\+919876543210/)
  assert.doesNotMatch(value.payload, /Abc123SECRET/)
  assert.doesNotMatch(value.payload, /message\.txt/)
  assert.match(value.payload, /"id": "source-1:a-1"/)
  assert.match(value.payload, /UNTRUSTED/)
})

test('sensitive data protection recognizes ID patterns and passwords', () => {
  const input = 'PAN ABCDE1234F Aadhaar 1234 5678 9012 card 4111111111111111 password=helloworld'
  const result = redactForCloud(input)
  assert.ok(result.count >= 4)
  assert.doesNotMatch(result.text, /ABCDE1234F|1234 5678 9012|4111111111111111|helloworld/)
})

test('AI suggestions with fabricated citations are rejected rather than added to graph', () => {
  const fake = JSON.stringify({ findings: [{ title: 'Certain criminal fraud', detail: 'This person is guilty of fraud', refs: ['source-0:invented'] }] })
  assert.deepEqual(validateAIReview(fake, documents, 'cloud'), [])
  const real = JSON.stringify({ findings: [{ title: 'Fee statements need confirmation', detail: 'Document statements may be inconsistent; independently verify details.', refs: ['source-0:a-1', 'source-1:a-0'], nextStep: 'Verify with official issuer.' }] })
  const findings = validateAIReview(real, documents, 'on-device')
  assert.equal(findings.length, 1)
  assert.equal(findings[0].status, 'Unverified hypothesis')
  assert.deepEqual(findings[0].refs, ['source-0:a-1', 'source-1:a-0'])
})

test('non-JSON model output is never treated as evidence', () => {
  assert.deepEqual(validateAIReview('It is 100% a scam', documents, 'cloud'), [])
  assert.deepEqual(validateAIReview('{"findings":[{"title":"Claim","detail":"Unsupported","refs":[]}]}', documents, 'cloud'), [])
})

test('report includes sources, uncertainty, exact anchors and no fabricated model claims', () => {
  const result = analyzeEvidence(documents)
  const report = reportInvestigation(result)
  assert.doesNotMatch(report, /offer\.txt|message\.txt|recruiter@example\.com|\+919876543210/)
  assert.match(report, /REDACTED LOCAL INVESTIGATION REPORT/)
  assert.match(report, /source-0:a-1/)
  assert.match(report, /LIMITATIONS/)
  assert.match(report, /not professional advice or fraud determinations/)
  const prompt = makeLocalPrompt(documents)
  assert.match(prompt, /SOURCE source-0:a-0/)
})

test('empty sources never generate AI or unverifiable findings', () => {
  const result = analyzeEvidence([])
  assert.deepEqual(result.findings, [])
  assert.deepEqual(result.entities, [])
  assert.deepEqual(buildGraph(result).nodes, [])
})


test('conflicting salary and joining dates get grounded but cautious conflict findings', () => {
  const sources = [
    { id: 'source-0', name: 'terms.txt', format: 'TXT', size: 20, warnings: [], segments: [
      { id: 'a-0', anchor: 'line 1', text: 'Monthly stipend ₹35,000 per month. Start date 2027-01-10.' },
    ] },
    { id: 'source-1', name: 'message.txt', format: 'TXT', size: 20, warnings: [], segments: [
      { id: 'a-0', anchor: 'line 1', text: 'Monthly stipend ₹25,000 per month. Start date 2027-02-10.' },
    ] },
  ]
  const results = analyzeEvidence(sources)
  assert.ok(results.findings.some(f => /Different compensation figures/.test(f.title) && f.status === 'Corroborated conflict'))
  assert.ok(results.findings.some(f => /Different start or joining dates/.test(f.title) && f.status === 'Corroborated conflict'))
  assert.ok(results.entities.some(e => e.kind === 'date'))
})

test('empty or unclear extraction is labelled insufficient rather than confirmed safe', () => {
  const safe = [{
    id: 'source-0', name: 'note.txt', format: 'TXT', size: 15, warnings: [],
    segments: [{ id: 'a-0', anchor: 'line 1', text: 'General meeting details.' }],
  }]
  const result = analyzeEvidence(safe)
  assert.equal(result.findings[0].status, 'Insufficient evidence')
})

test('local PII candidates must be literal evidence strings; no phantom masking', () => {
  const raw = JSON.stringify({ findings: [], privacyCandidates: ['Northstar Labs', 'invented private name', '123'] })
  const accepted = validatePrivacyCandidates(raw, documents)
  assert.deepEqual(accepted, ['Northstar Labs'])
  const draft = makeCloudPayload(documents, accepted)
  assert.doesNotMatch(draft.payload, /Northstar Labs/)
  assert.match(draft.payload, /LOCAL_AI_REDACTED/)
  const exportText = reportInvestigation(analyzeEvidence(documents), accepted)
  assert.doesNotMatch(exportText, /Northstar Labs|recruiter@example.com/)
  assert.equal(redactWithSuggestions('Northstar Labs', accepted).count, 1)
})

test('exact cloud JSON must be valid, redacted, known-source data after user edits', () => {
  const draft = makeCloudPayload(documents)
  assert.equal(validateApprovedCloudPayload(draft.payload, documents), null)
  const altered = JSON.parse(draft.payload)
  altered.redactedEvidence[0].excerpt += ' email leak abc@example.com'
  assert.match(validateApprovedCloudPayload(JSON.stringify(altered), documents), /sensitive identifier/)
  altered.redactedEvidence[0].excerpt = 'Safe paraphrase.'
  altered.redactedEvidence[0].id = 'source-0:invented'
  assert.match(validateApprovedCloudPayload(JSON.stringify(altered), documents), /real source ID/)
  assert.match(validateApprovedCloudPayload(draft.payload + 'NOT_JSON', documents), /valid JSON/)
})
