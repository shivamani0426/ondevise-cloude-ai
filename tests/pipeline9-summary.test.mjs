import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeEvidence, reportInvestigation } from '../src/pipeline/core.ts'
import { buildInvestigationSummary } from '../src/pipeline/summary.ts'

const doc=(id,format,rows)=>({
  id:'source-'+id,name:'private-'+id+'.'+format.toLowerCase(),format,
  size:rows.join('').length,warnings:[],
  segments:rows.map((text,i)=>({id:'a-'+i,anchor:'line '+(i+1),text})),
})
const invoice=()=>[
  doc(0,'TXT',['Invoice ID: INV-2027-0042','amount_usd: 350','status: issued']),
  doc(1,'CSV',['invoice_id,amount_usd,status','INV-2027-0042,450,issued']),
]

test('9A: source-grounded summary consolidates invoice values with auditable citations',()=>{
  const investigation=analyzeEvidence(invoice())
  const summary=buildInvestigationSummary(investigation)
  assert.equal(summary.sourceCount,2)
  assert.equal(summary.ruleFindingCount,1)
  assert.equal(summary.findings.length,1)
  assert.equal(summary.status,'Review required')
  assert.deepEqual(summary.findings[0].compared.map(value=>value.value),['350','450'])
  assert.ok(summary.findings[0].citations.every(citation=>
    invoice().some(doc=>doc.id===citation.documentId &&
      doc.segments.some(segment=>doc.id+':'+segment.id===citation.ref && segment.anchor===citation.anchor))))
  assert.match(summary.findings[0].context,/USD/)
  assert.doesNotMatch(summary.overview,/fraud proven|criminal conduct/i)
})

test('9B: AI-selected passages cannot inflate the rule finding count',()=>{
  const investigation=analyzeEvidence(invoice())
  investigation.findings.push({
    id:'ai-1',origin:'on-device',title:'AI-selected passages for rule review',
    status:'Unverified hypothesis',detail:'Unverified selection',
    nextStep:'Check excerpts',refs:['source-0:a-1'],
  })
  const summary=buildInvestigationSummary(investigation)
  assert.equal(summary.ruleFindingCount,1)
  assert.equal(summary.aiEvidenceGroupCount,1)
  assert.equal(summary.findings.length,1)
})

test('9C: fabricated citation and non-source value never enter summary',()=>{
  const investigation=analyzeEvidence(invoice())
  investigation.findings[0].refs.push('fabricated:ref')
  investigation.findings[0].explanation.compared.push({ref:'source-0:a-1',field:'amount usd',value:'999999'})
  const summary=buildInvestigationSummary(investigation)
  assert.ok(summary.findings[0].citations.every(c=>c.ref!=='fabricated:ref'))
  assert.ok(summary.findings[0].compared.every(c=>c.value!=='999999'))
})

test('9D: clean case does not assert documents are authentic',()=>{
  const result=analyzeEvidence([doc(0,'TXT',['Plain factual narrative without detectable markers'])])
  const summary=buildInvestigationSummary(result)
  assert.equal(summary.ruleFindingCount,0)
  assert.equal(summary.status,'No rule-based concern detected')
  assert.match(summary.overview,/not proof/)
})

test('9E: redacted local report includes summary without source filenames',()=>{
  const report=reportInvestigation(analyzeEvidence(invoice()))
  assert.match(report,/INVESTIGATION SUMMARY/)
  assert.match(report,/Source-linked rule findings: 1/)
  assert.doesNotMatch(report,/private-0\.txt|private-1\.csv/)
  assert.match(report,/Citations:/)
})
