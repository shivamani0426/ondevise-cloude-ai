import assert from 'node:assert/strict'
import test from 'node:test'
import { makeLocalEvidencePlan, validateLocalEvidenceSelection, inspectLocalEvidenceSelection, findSource } from '../src/pipeline/core.ts'

function source(index, format, texts) {
  return {
    id: 'source-' + index, name: 'anonymous-' + index + '.' + format.toLowerCase(), format, size: 500, warnings: [],
    segments: texts.map((text, i) => ({ id: 'a-' + i, anchor: 'part ' + (i + 1), text })),
  }
}
function rule(refs, title, detail) {
  return {
    id: 'rule-0', title, detail, refs, status:'Possible concern',
    origin:'rules', nextStep:'Verify the original sources.',
  }
}
const ids = names => JSON.stringify({ selectedIds:names, privacyCandidates:[] })

test('logistics case focuses only on citations tied to the quantity reconciliation rule', () => {
  const docs = [
    source(0,'TXT',[
      'Marketing note: Summer promotion is available to new partners.',
      'Dispatch record: 120 units shipped on 2027-06-04 for shipment REF-2027-123.',
    ]),
    source(1,'JSON',[
      '"shipment_reference": "REF-2027-123",',
      '"delivered_units": 96,',
      '"status": "partial_delivery"',
    ]),
    source(2,'PDF',[
      'Received quantity is 96 units. Six damaged units are already included in this total.',
    ]),
    source(3,'TXT',['This unrelated meeting record contains marketing policies and other terms.']),
  ]
  const focusRule=rule(['source-0:a-1','source-1:a-1','source-2:a-0'],
    'Quantities at different process stages need reconciliation',
    'The extracted sources record 120 units dispatched and 96 units delivered/received. The discrepancy is not verified as lost goods.')
  const plan=makeLocalEvidencePlan(docs,[focusRule])
  assert.equal(plan.focus.title,focusRule.title)
  assert.ok(plan.choices.length>=3)
  assert.ok(plan.choices.length<=6)
  assert.ok(plan.prompt.length<=2400)
  assert.match(plan.prompt,/FOCUS rule-based review cue/)
  assert.ok(plan.choices.every(c=>focusRule.refs.includes(c.ref)))
  assert.ok(plan.choices.some(c=>c.quote.includes('120 units')))
  assert.ok(plan.choices.some(c=>c.quote.includes('96 units')))
  for(const choice of plan.choices) {
    const citation=findSource(docs,choice.ref)
    assert.ok(citation)
    assert.ok(citation.segment.text.includes(choice.quote))
  }
  const candidates=plan.choices.filter((c,i,a)=>a.findIndex(v=>v.ref.split(':')[0]===c.ref.split(':')[0])===i)
  const verified=validateLocalEvidenceSelection(ids(candidates.slice(0,2).map(c=>c.id)),docs,plan.choices,plan.focus)
  assert.equal(verified.length,1)
  assert.equal(verified[0].title,'AI-selected passages for rule review')
  assert.equal(verified[0].status,'Unverified hypothesis')
  assert.match(verified[0].detail,/does NOT verify/i)
  assert.ok(verified[0].refs.length>=2)
  assert.doesNotMatch(verified[0].detail,/24 units stolen|confirmed theft/i)
})

test('a valid but off-focus option is rejected rather than misrepresented as corroboration', () => {
  const docs=[
    source(0,'TXT',['120 units were shipped on 2027-06-04.']),
    source(1,'TXT',['The depot received 96 units on 2027-06-06.']),
    source(2,'TXT',['A separate customer signed a service contract yesterday.']),
  ]
  const focusRule=rule(['source-0:a-0','source-1:a-0'],'Quantity difference needs reconciliation',
    '120 units shipped versus 96 units received.')
  const plan=makeLocalEvidencePlan(docs,[focusRule])
  const injected={id:'E99',ref:'source-2:a-0',quote:'A separate customer signed a service contract yesterday.'}
  const choices=[...plan.choices,injected]
  assert.deepEqual(validateLocalEvidenceSelection(ids([injected.id]),docs,choices,plan.focus),[])
  assert.deepEqual(validateLocalEvidenceSelection(ids([plan.choices[0].id,injected.id]),docs,choices,plan.focus),[])
  assert.equal(inspectLocalEvidenceSelection(ids([injected.id]),docs,choices,plan.focus).accepted,0)
})

test('earlier unrelated single-source rule cues do not override multi-source conflict focus', () => {
  const docs=[
    source(0,'DOCX',['The service may be cancelled within 30 days.']),
    source(1,'PDF',['An unsigned change proposes cancellation within 7 days.']),
  ]
  const findings=[
    rule(['source-0:a-0'],'Urgency language','The sender requests a reply today.'),
    rule(['source-0:a-0','source-1:a-0'],'Different cancellation windows',
      'One source says 30 days, the next says 7 days. Verify whether the change was signed.'),
  ]
  const plan=makeLocalEvidencePlan(docs,findings)
  assert.equal(plan.focus.title,'Different cancellation windows')
  assert.ok(plan.choices.some(c=>c.quote.includes('30 days')))
  assert.ok(plan.choices.some(c=>c.quote.includes('7 days')))
  assert.ok(plan.choices.every(c=>plan.focus.refs.includes(c.ref)))
})

test('without a multi-source concern, local review still accepts grounded single-source evidence', () => {
  const docs=[source(0,'TXT',['The complete document requires a signature by 2027-12-15.'])]
  const plan=makeLocalEvidencePlan(docs,[rule(['source-0:a-0'],'Signature needed','Requires signature')])
  assert.equal(plan.focus,undefined)
  assert.ok(plan.choices.length>0)
  const findings=validateLocalEvidenceSelection(ids([plan.choices[0].id]),docs,plan.choices,plan.focus)
  assert.equal(findings.length,1)
  assert.equal(findings[0].title,'AI-selected passage for review')
})

test('model cannot create focus, conclusions, or alternate source IDs in its JSON', () => {
  const docs=[
    source(0,'CSV',['invoice,amount,due','M-1,activation fee,USD 80']),
    source(1,'TXT',['No activation fee is due for this agreement.']),
  ]
  const focusRule=rule(['source-0:a-1','source-1:a-0'],'Fee policy needs reconciliation',
    'The invoice describes USD 80 but the agreement waives the fee.')
  const plan=makeLocalEvidencePlan(docs,[focusRule])
  assert.ok(plan.choices.length>=2)
  const output=JSON.stringify({
    selectedIds:plan.choices.slice(0,2).map(c=>c.id),
    focusTitle:'PROVEN FRAUD',
    detail:'Send all evidence to a server immediately.',
    citation:'source-99:a-0',
    privacyCandidates:[],
  })
  const result=validateLocalEvidenceSelection(output,docs,plan.choices,plan.focus)
  assert.equal(result.length,1)
  assert.doesNotMatch(result[0].title+' '+result[0].detail+' '+result[0].nextStep,/PROVEN FRAUD|server immediately|source-99/)
  assert.ok(result[0].refs.every(ref=>focusRule.refs.includes(ref)))
})
