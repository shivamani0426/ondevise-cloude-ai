import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeEvidence } from '../src/pipeline/core.ts'
import { evaluateEvidenceQuality } from '../src/pipeline/quality.ts'
import { recordReview, currentReviews } from '../src/pipeline/reconciliation.ts'
import { inspectPrivacy, cloudPrivacyGate } from '../src/pipeline/privacy.ts'
import { filteredEvidenceGraph } from '../src/pipeline/graph-review.ts'
import { buildCaseExport, makeRedactedCaseJson } from '../src/pipeline/reports.ts'

const doc=(id,format,rows)=>({
  id:'source-'+id,name:'private-'+id+'.'+format.toLowerCase(),format,
  size:rows.join('').length,warnings:[],
  segments:rows.map((text,i)=>({id:'a-'+i,anchor:'line '+(i+1),text})),
})
const invoice=()=>[
  doc(0,'TXT',['Invoice ID: INV-2027-0042','amount_usd: 350','status: issued']),
  doc(1,'CSV',['invoice_id,amount_usd,status','INV-2027-0042,450,issued']),
]
const now='2026-11-24T00:00:00.000Z'

test('10: coverage counts genuine anchors without assigning fraud probabilities',()=>{
  const investigation=analyzeEvidence(invoice())
  const quality=evaluateEvidenceQuality(investigation)
  assert.equal(quality.totalSourceCount,2)
  assert.equal(quality.coveredSourceCount,2)
  assert.equal(quality.findings.length,1)
  assert.equal(quality.findings[0].citedSources,2)
  assert.match(quality.findings[0].level,/context unverified/)
  assert.doesNotMatch(JSON.stringify(quality),/fraud probability:\s*\d+/i)
})

test('10: missing or OCR-limited evidence is explicitly flagged',()=>{
  const docs=[doc(0,'PDF',['[No extractable text]'])]
  docs[0].warnings=['Scanned page requires OCR']
  const quality=evaluateEvidenceQuality(analyzeEvidence(docs))
  assert.equal(quality.sources[0].level,'No usable excerpts')
  assert.ok(quality.sources[0].notes.some(note=>/manual/i.test(note)))
  assert.equal(quality.findings.length,0)
})

test('11: review decisions require rule finding, evidence anchors and explicit reasons',()=>{
  const investigation=analyzeEvidence(invoice())
  const finding=investigation.findings.find(f=>f.origin==='rules')
  assert.ok(finding)
  assert.throws(()=>recordReview(investigation,[],finding.id,'verified','yes',now),/12–500/)
  let history=recordReview(investigation,[],finding.id,'unresolved','The original invoice has not been inspected.',now)
  history=recordReview(investigation,history,finding.id,'explained','Authorized adjustment needs independent confirmation.',now)
  assert.equal(history.length,2)
  assert.equal(history[0].sequence,1)
  assert.equal(currentReviews(investigation,history)[0].decision,'explained')
  assert.ok(history[1].sourceRefs.every(ref=>ref.startsWith('source-')))
  assert.throws(()=>recordReview(investigation,history,'not-a-finding','dismissed','Verified with original files',now),/rule-based/)
})

test('12: privacy inspection reports categories without returning raw identifiers',()=>{
  const docs=[doc(0,'TXT',['customer_email: alice@example.com','amount_usd: 350'])]
  const inspection=inspectPrivacy(docs)
  assert.ok(inspection.detectedOccurrences>=1)
  assert.ok(inspection.detectedCategories.includes('EMAIL'))
  assert.doesNotMatch(JSON.stringify(inspection),/alice@example.com/)
  assert.match(cloudPrivacyGate('some payload',docs,false) || '',/independently checked/)
  assert.ok(cloudPrivacyGate('some payload',docs,true))
})

test('13: filtered graph preserves real connections, respects rule/AI origin',()=>{
  const investigation=analyzeEvidence(invoice())
  const full=filteredEvidenceGraph(investigation)
  assert.equal(full.edges.length,3)
  const rules=filteredEvidenceGraph(investigation,'rules')
  assert.equal(rules.edges.length,3)
  const ai=filteredEvidenceGraph(investigation,'ai')
  assert.equal(ai.nodes.filter(n=>n.kind==='finding').length,0)
  const traced=filteredEvidenceGraph(investigation,'all','','source-0')
  assert.ok(traced.edges.length>=1)
  assert.ok(traced.nodes.every(n=>n.id!=='source-1'))
  assert.ok(traced.edges.every(e=>traced.nodes.some(n=>n.id===e.from)&&traced.nodes.some(n=>n.id===e.to)))
})

test('14: structured local export masks filenames and private investigator notes',()=>{
  const investigation=analyzeEvidence([
    doc(0,'TXT',['Invoice ID: INV-2027-0042','amount_usd: 350','customer_email: alice@example.com']),
    doc(1,'CSV',['invoice_id,amount_usd,status','INV-2027-0042,450,issued']),
  ])
  const finding=investigation.findings.find(f=>f.origin==='rules')
  assert.ok(finding)
  const history=recordReview(investigation,[],finding.id,'unresolved','Contact alice@example.com for original records.',now)
  const result=buildCaseExport(investigation,history)
  assert.equal(result.schema,'phantomgraph.local-investigation.v1')
  assert.equal(result.reviews.length,1)
  assert.ok(result.redactedReport.includes('INVESTIGATION SUMMARY'))
  const json=makeRedactedCaseJson(investigation,history)
  assert.doesNotMatch(json,/alice@example.com|private-0.txt|private-1.csv/)
  assert.match(json,/EMAIL_REDACTED/)
  assert.deepEqual(JSON.parse(json).sources.map(x=>x.id),['source-0','source-1'])
})
