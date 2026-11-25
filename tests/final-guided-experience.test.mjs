import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeEvidence, makeLocalEvidencePlan, validateLocalEvidenceSelection, reportInvestigation } from '../src/pipeline/core.ts'
import { buildInvestigationSummary } from '../src/pipeline/summary.ts'
const doc=(i,lines)=>({id:'source-'+i,name:'private-'+i+'.txt',format:'TXT',size:100,warnings:[],segments:lines.map((text,j)=>({id:'a-'+j,anchor:'line '+(j+1),text}))})
test('matching dates are distinguished from mere identity and discrepancies',()=>{
  const a=doc(0,['Application ID APP-2030-210 has an issue date of 2030-01-02.'])
  const b=doc(1,['Application ID: APP-2030-210','date_of_issue: 2030-01-02'])
  const summary=buildInvestigationSummary(analyzeEvidence([a,b]))
  assert.equal(summary.outcome,'matching')
  assert.equal(summary.concernCount,0)
  assert.equal(summary.findings[0].agreement.length,2)
  const unknown=buildInvestigationSummary(analyzeEvidence([a,doc(1,['Application ID: APP-2030-210'])]))
  assert.equal(unknown.outcome,'uncertain')
})
test('local discrepancy review requires both grounded compared amounts',()=>{
  const docs=[doc(0,['Claim ID CLM-2030-105 has a claimed amount of INR 5000.']),doc(1,['Claim ID: CLM-2030-105','claim_amount: INR 8000'])]
  const caseData=analyzeEvidence(docs)
  const plan=makeLocalEvidencePlan(docs,caseData.findings)
  assert.equal(plan.choices.length,2)
  assert.ok(plan.choices.some(x=>x.quote.includes('5000')))
  assert.ok(plan.choices.some(x=>x.quote.includes('8000')))
  const raw=ids=>JSON.stringify({selectedIds:ids})
  assert.equal(validateLocalEvidenceSelection(raw([plan.choices[0].id]),docs,plan.choices,plan.focus).length,0)
  assert.equal(validateLocalEvidenceSelection(raw(plan.choices.map(x=>x.id)),docs,plan.choices,plan.focus).length,1)
  assert.equal(buildInvestigationSummary(caseData).outcome,'difference')
})
test('partial reference label and cloud report language are accurate',()=>{
  const docs=[doc(0,['Order ID: ORD-2030-1234','amount: INR 1000']),doc(1,['Order ID ending in 1234','amount: INR 1500'])]
  const data=analyzeEvidence(docs)
  assert.ok(data.entities.some(e=>e.label.includes('1234')&&e.label.includes('ending')))
  assert.equal(buildInvestigationSummary(data).outcome,'uncertain')
  assert.match(reportInvestigation(data),/Cloud AI is disabled/)
})
