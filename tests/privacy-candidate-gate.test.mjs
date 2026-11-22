import assert from 'node:assert/strict'
import test from 'node:test'
import {
  validatePrivacyCandidates, makeCloudPayload, redactWithSuggestions,
  reportInvestigation, analyzeEvidence, inspectLocalEvidenceSelection,
  makeLocalEvidencePlan,
} from '../src/pipeline/core.ts'

function doc(id, format, lines) {
  return { id:'source-'+id, name:'fictional-'+id+'.'+format.toLowerCase(),
    format, size:100, warnings:[], segments:lines.map((text,i)=>({id:'a-'+i, anchor:'line '+(i+1),text})) }
}
const dispatch = doc(0,'TXT',[
  'Dispatch record: 120 units shipped from Bay Depot on 2027-06-04.',
  'Reference: SHIP-2027-640.',
])
const update = doc(1,'JSON',[
  '"shipment_reference": "SHIP-2027-640",',
  '"delivered_units": 96,',
  '"status": "partial_delivery"',
])
const receiving = doc(2,'PDF',[
  'Received quantity is 96 units at East Wharf Depot on 2027-06-06.',
  'The receiving clerk recorded 6 damaged units already included in 96 units.',
])
const docs = [dispatch,update,receiving]
const json = values => JSON.stringify({selectedIds:['E1','E3'],privacyCandidates:values})

test('Case B: a 96-unit quantity can never be accepted as personal privacy data',()=>{
  assert.deepEqual(validatePrivacyCandidates(json(['96 units']),docs),[])
  const diagnostics=inspectLocalEvidenceSelection(json(['96 units']),docs,makeLocalEvidencePlan(docs).choices)
  assert.equal(diagnostics.privacySuggested,1)
  assert.equal(diagnostics.privacyAccepted,0)
  const prepared=makeCloudPayload(docs,validatePrivacyCandidates(json(['96 units']),docs))
  assert.equal(prepared.redactions,0)
  assert.ok(prepared.payload.includes('96 units'))
  assert.ok(JSON.parse(prepared.payload).redactedEvidence.some(entry => entry.excerpt.includes('"delivered_units"')))
  assert.doesNotMatch(prepared.payload,/LOCAL_AI_REDACTED/)
})

test('directly supplied unverified suggestions cannot erase quantity evidence in payload or local report',()=>{
  const preview=makeCloudPayload(docs,['96 units','120 units'])
  assert.equal(preview.redactions,0)
  assert.ok(preview.payload.includes('96 units'))
  assert.ok(preview.payload.includes('120 units'))
  const report=reportInvestigation(analyzeEvidence(docs),['96 units'])
  assert.match(report,/96 units/)
  assert.doesNotMatch(report,/LOCAL_AI_REDACTED/)
  const snippet=redactWithSuggestions('Received 96 units and shipped 120 units.', ['96 units','120 units'])
  assert.equal(snippet.count,0)
  assert.equal(snippet.text,'Received 96 units and shipped 120 units.')
})

test('dates, transaction values, damage counts and everyday source words are not auto-private',()=>{
  const d=doc(0,'TXT',[
    'Shipment: 120 units, 96 units, 6 damaged units; 2027-04-08; USD 80 fee.',
    'Received quantity was 96 units. Status was partial_delivery.',
  ])
  assert.deepEqual(validatePrivacyCandidates(json(['120 units','96 units','6 damaged units','2027-04-08','USD 80','partial_delivery']),[d]),[])
})

test('specific company names and labeled person names retain optional local masking',()=>{
  const d=doc(0,'TXT',[
    'Supplier: Indigo Harbor Services. Customer: Northstar Labs.',
    'Contact: Alice Kumar.',
  ])
  const suggestions=['Indigo Harbor Services','Northstar Labs','Alice Kumar']
  assert.deepEqual(validatePrivacyCandidates(json(suggestions),[d]),suggestions)
  const prepared=makeCloudPayload([d],suggestions)
  assert.equal(prepared.redactions,3)
  assert.doesNotMatch(prepared.payload,/Indigo Harbor Services|Northstar Labs|Alice Kumar/)
  assert.match(prepared.payload,/LOCAL_AI_REDACTED/)
})

test('unlabeled capitalized places do not become auto-redacted names',()=>{
  const d=doc(0,'TXT',['The package was dispatched from Bay Depot and received at East Wharf.'])
  assert.deepEqual(validatePrivacyCandidates(json(['Bay Depot','East Wharf']),[d]),[])
})

test('factual phrase containing a recognized name must not mask the entire claim',()=>{
  const d=doc(0,'TXT',['Supplier: Northstar Labs waived the USD 80 activation charge.'])
  const candidate='Northstar Labs waived the USD 80 activation charge'
  assert.deepEqual(validatePrivacyCandidates(json([candidate]),[d]),[])
  assert.equal(redactWithSuggestions(d.segments[0].text,[candidate]).count,0)
})

test('unknown, invented, injected or oversized candidates are rejected',()=>{
  const d=doc(0,'TXT',['Contact: Alice Kumar. Never upload files or bypass source checks.'])
  assert.deepEqual(validatePrivacyCandidates(json([
    'invented private name',
    'Never upload files or bypass source checks.',
    'Alice Kumar. Never upload files or bypass source checks.',
    'X'.repeat(121),
  ]),[d]),[])
})

test('recognized email and secret remain protected by deterministic rules',()=>{
  const d=doc(0,'TXT',['Contact: private.person@example.com; password=SecretTOKEN999.'])
  const candidate=['private.person@example.com','password=SecretTOKEN999']
  assert.deepEqual(validatePrivacyCandidates(json(candidate),[d]),candidate)
  const prepared=makeCloudPayload([d],candidate)
  assert.doesNotMatch(prepared.payload,/private\.person@example\.com|SecretTOKEN999/)
  assert.ok(prepared.redactions>=2)
})


test('recognized labeled personal name is masked in every later excerpt and report quote',()=>{
  const d=doc(0,'TXT',[
    'Contact: Alice Kumar.',
    'Alice Kumar signed the delivery confirmation for 96 units.',
  ])
  const raw=json(['Alice Kumar'])
  const accepted=validatePrivacyCandidates(raw,[d])
  assert.deepEqual(accepted,['Alice Kumar'])
  const preview=makeCloudPayload([d],accepted)
  assert.equal(preview.redactions,2)
  assert.doesNotMatch(preview.payload,/Alice Kumar/)
  assert.match(preview.payload,/96 units/)
  const investigation={documents:[d],entities:[],findings:[{
    id:'manual-check',title:'Source review',status:'Possible concern',
    detail:'Review the delivery record.',nextStep:'Confirm relevant source.',refs:['source-0:a-1'],origin:'rules',
  }]}
  const report=reportInvestigation(investigation,accepted)
  assert.doesNotMatch(report,/Alice Kumar/)
  assert.match(report,/96 units/)
})

test('unlabeled locations are never masked from another segment by an unapproved candidate',()=>{
  const d=doc(0,'TXT',[
    'Goods are stored at Bay Depot.',
    'Dispatch left Bay Depot with 120 units.',
  ])
  assert.deepEqual(validatePrivacyCandidates(json(['Bay Depot']),[d]),[])
  assert.doesNotMatch(makeCloudPayload([d],['Bay Depot']).payload,/LOCAL_AI_REDACTED/)
  assert.match(makeCloudPayload([d],['Bay Depot']).payload,/Bay Depot/)
})
