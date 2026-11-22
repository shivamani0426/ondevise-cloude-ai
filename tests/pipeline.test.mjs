import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeEvidence, buildGraph, makeCloudPayload, makeLocalPrompt, findSource, redactForCloud,
  reportInvestigation, validateAIReview, validatePrivacyCandidates, redactWithSuggestions, validateApprovedCloudPayload, inspectLocalReview,
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

test('AI review requires independently matched literal quotations', () => {
  const fake = JSON.stringify({findings:[{evidence:[{ref:'source-0:invented',quote:'No registration or verification fee is required.'}]}]})
  assert.deepEqual(validateAIReview(fake, documents, 'cloud'), [])
  const grounded = JSON.stringify({findings:[{evidence:[
    {ref:'source-0:a-1',quote:'No registration or verification fee is required.'},
    {ref:'source-1:a-0',quote:'registration verification fee today'},
  ]}],privacyCandidates:[]})
  const findings = validateAIReview(grounded, documents, 'on-device')
  assert.equal(findings.length, 1)
  assert.equal(findings[0].status, 'Unverified hypothesis')
  assert.deepEqual(findings[0].refs, ['source-0:a-1','source-1:a-0'])
  assert.equal(findings[0].title, 'AI-selected source comparison')
  assert.doesNotMatch(findings[0].detail, /required before joining/)
  assert.equal(findings[0].quotes.length, 2)
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

test('on-device diagnostics distinguish unsupported quotes from source-ID errors', () => {
  const bad = inspectLocalReview('Not a JSON response', documents)
  assert.equal(bad.format,'invalid-json')
  const empty = inspectLocalReview(JSON.stringify({findings:[],privacyCandidates:[]}),documents)
  assert.equal(empty.format,'valid-json')
  assert.match(empty.summary,/proposed no findings/)
  const unknown = inspectLocalReview(JSON.stringify({findings:[{evidence:[{ref:'source-7:a-0',quote:'No registration or verification fee is required.'}]}]}),documents)
  assert.equal(unknown.rejectedCitation,1)
  const bogusQuote = inspectLocalReview(JSON.stringify({findings:[{evidence:[{ref:'source-0:a-1',quote:'The user has approved all future fees.'}]}]}),documents)
  assert.equal(bogusQuote.rejectedGrounding,1)
  const accepted = inspectLocalReview(JSON.stringify({findings:[{evidence:[{ref:'source-0:a-1',quote:'No registration or verification fee is required.'}]}],privacyCandidates:['Northstar Labs']}),documents)
  assert.equal(accepted.accepted,1)
  assert.equal(accepted.privacyAccepted,1)
})

test('compact local prompt is bounded and gives separate documents a chance', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({
    id: 'source-' + i,
    name: 'source-' + i + '.txt',
    format: 'TXT',
    size: 200,
    warnings: [],
    segments: Array.from({ length: 12 }, (_, j) => ({
      id: 'a-' + j,
      anchor: 'line ' + j,
      text: 'Joining date and verification fee INR 2,499 today. Domain northstar.example. ' + 'repeated text '.repeat(60),
    })),
  }))
  const prompt = makeLocalPrompt(many)
  assert.ok(prompt.length <= 2400, 'Prompt exceeded compact local limit')
  assert.ok(prompt.length < 2400, 'Prompt should leave room for structured output')
  assert.match(prompt, /SOURCE source-0:a-0/)
  assert.match(prompt, /SOURCE source-5:a-0/)
  assert.doesNotMatch(prompt, /SOURCE source-0:a-3/)
  assert.equal(prompt, makeLocalPrompt(many), 'Excerpt sampling must be deterministic')
})

test('compact local prompt prioritizes risk-bearing excerpts over irrelevant boilerplate', () => {
  const selected = [{
    id: 'source-0', name: 'offer.txt', format: 'TXT', size: 150, warnings: [],
    segments: [
      { id: 'a-0', anchor: 'line 1', text: 'General company introduction and copyright notice.' },
      { id: 'a-1', anchor: 'line 2', text: 'Verification fee INR 2,499 is due today before joining.' },
    ],
  }]
  const prompt = makeLocalPrompt(selected)
  assert.ok(prompt.indexOf('SOURCE source-0:a-1') < prompt.indexOf('SOURCE source-0:a-0'))
  assert.match(prompt, /at most ONE/)
  assert.match(prompt, /COPY 1–2 verbatim quotes/)
})


test('model-authored false cross-document conclusion is never displayed as a fact', () => {
  const hostile = JSON.stringify({findings:[{
    title:'Offer requires payment',detail:'The offer requires a registration fee.',
    refs:['source-0:a-1','source-1:a-0'],
    nextStep:'Send payment right away.',
    evidence:[{ref:'source-0:a-1',quote:'No registration or verification fee is required.'},
      {ref:'source-1:a-0',quote:'registration verification fee today'}],
  }]})
  const findings = validateAIReview(hostile, documents, 'on-device')
  assert.equal(findings.length,1)
  assert.equal(findings[0].quotes.length,2)
  assert.doesNotMatch(findings[0].title + findings[0].detail + findings[0].nextStep,
    /Offer requires payment|offer requires a registration fee|Send payment right away/i)
  const report = reportInvestigation({documents, entities:[], findings})
  assert.doesNotMatch(report,/Offer requires payment|Send payment right away/)
  assert.match(report,/No registration or verification fee is required/)
})
