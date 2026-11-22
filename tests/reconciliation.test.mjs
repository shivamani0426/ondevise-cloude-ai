import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeEvidence, findSource } from '../src/pipeline/core.ts'
import { compareDocumentClaims } from '../src/pipeline/compare.ts'

function doc(id, format, parts) {
  return { id:'source-'+id, name:'fictional-'+id+'.'+format.toLowerCase(), format, size:800, warnings:[],
    segments:parts.map((text,i)=>({id:'a-'+i,anchor:'excerpt '+(i+1),text})) }
}

test('unrelated service agreement, unsigned change, and invoice yield cautious term and fee reviews', () => {
  const sources=[
    doc(0,'PDF',[
      'Service Agreement - Revision 1. Cancellation is free within 30 calendar days of activation.',
      'The service activates on 2027-04-12. No activation fee is due under Revision 1.',
    ]),
    doc(1,'DOCX',[
      'Change Order - Revision 2',
      'Cancellation after 7 calendar days incurs a charge of USD 80.',
      'The new activation date is 2027-04-20.',
      'This change order amends Revision 1 only if signed by both parties.',
      'Supplier: Example Services. Customer: Example Studio. Signature status: pending review.',
    ]),
    doc(2,'CSV',[
      'entry,description,amount_usd,due_date,invoice_status',
      'B-101,activation fee,80,2027-04-08,unpaid',
      'B-102,monthly service,320,2027-04-20,scheduled',
    ]),
  ]
  const findings=compareDocumentClaims(sources)
  assert.ok(findings.some(f=>/cancellation or refund windows/.test(f.title)))
  assert.ok(findings.some(f=>/activation or effective dates/.test(f.title)))
  assert.ok(findings.some(f=>/Fee policy and billing/.test(f.title)))
  assert.ok(findings.some(f=>/Approval or signature/.test(f.title)))
  const fee=findings.find(f=>/Fee policy and billing/.test(f.title))
  assert.ok(fee.refs.includes('source-0:a-1'))
  assert.ok(fee.refs.includes('source-2:a-1'))
  for(const finding of findings) {
    assert.equal(finding.status,'Possible concern')
    assert.equal(finding.origin,'rules')
    for(const ref of finding.refs) assert.ok(findSource(sources,ref))
    assert.doesNotMatch(finding.title+' '+finding.detail,/confirmed fraud|legally binding|certainly unlawful/i)
  }
  const all=analyzeEvidence(sources)
  assert.ok(all.findings.some(f=>/cancellation or refund windows/.test(f.title)))
  assert.ok(!all.findings.some(f=>f.title==='No rule-matched concern found'))
})

test('dispatch, carrier JSON, and receiving PDF flag a stage reconciliation without alleging theft',()=>{
  const sources=[
    doc(0,'TXT',['Dispatch record: 120 units shipped from Bay Depot on 2027-06-04.',
      'Shipment reference: SHIP-2027-640.']),
    doc(1,'JSON',['"shipment_reference": "SHIP-2027-640",',
      '"delivered_units": 96,','"status": "partial_delivery",']),
    doc(2,'PDF',['Received quantity is 96 units at East Wharf Depot on 2027-06-06.',
      'The receiving clerk recorded 6 damaged units, already included in the received total.',
      'Shipment reference: SHIP-2027-640.']),
  ]
  const findings=compareDocumentClaims(sources)
  assert.ok(findings.some(f=>/Quantities at different/.test(f.title)))
  const q=findings.find(f=>/Quantities at different/.test(f.title))
  assert.match(q.detail,/120 units dispatched/)
  assert.match(q.detail,/96 units delivered/)
  assert.ok(q.refs.includes('source-0:a-0'))
  assert.ok(q.refs.includes('source-1:a-1'))
  assert.ok(q.refs.includes('source-2:a-0'))
  assert.doesNotMatch(JSON.stringify(findings),/stolen|theft|24 units lost|6 extra units missing/)
})

test('different referenced shipments are not mixed into one discrepancy',()=>{
  const sources=[
    doc(0,'TXT',['200 units shipped on 2027-02-01. Reference: PKG-2027-100']),
    doc(1,'TXT',['150 units received on 2027-02-03. Reference: PKG-2027-200']),
  ]
  assert.ok(!compareDocumentClaims(sources).some(f=>/Quantities/.test(f.title)))
})

test('identical quantities and policy windows are not falsely treated as mismatches',()=>{
  const sources=[
    doc(0,'PDF',['10 packages shipped. Cancellation allowed within 21 calendar days.']),
    doc(1,'DOCX',['10 packages delivered. Cancellation allowed within 21 calendar days.']),
  ]
  assert.deepEqual(compareDocumentClaims(sources),[])
})

test('fee matching requires the same named fee topic, not unrelated costs',()=>{
  const sources=[
    doc(0,'PDF',['No activation fee is due for this service.']),
    doc(1,'CSV',['item,amount','late fee,200']),
  ]
  assert.ok(!compareDocumentClaims(sources).some(f=>/Fee policy/.test(f.title)))
})

test('activation and invoice due dates are different fields, not a false contradiction',()=>{
  const sources=[
    doc(0,'PDF',['The service activates on 2027-04-20.']),
    doc(1,'CSV',['line,description,amount,due_date','L-1,service,300,2027-04-08']),
  ]
  assert.ok(!compareDocumentClaims(sources).some(f=>/activation or effective dates/.test(f.title)))
})

test('term comparisons work with non-recruitment subjects and no AI connection',()=>{
  const sources=[
    doc(0,'TXT',['The returned item qualifies for a refund within 14 days.']),
    doc(1,'MD',['Returns qualify for a refund within 30 days.']),
  ]
  assert.ok(compareDocumentClaims(sources).some(f=>/cancellation or refund windows/.test(f.title)))
})

test('no matching claims yields insufficient evidence, not a clean bill of health',()=>{
  const sources=[
    doc(0,'TXT',['Museum opening hours and exhibition description.']),
    doc(1,'TXT',['An unrelated biography of an artist.']),
  ]
  const findings=analyzeEvidence(sources).findings
  assert.equal(findings.length,1)
  assert.equal(findings[0].status,'Insufficient evidence')
})

test('file name alone never influences the inferred claim or accusation',()=>{
  const sources=[
    doc(0,'PDF',['120 units shipped on 2027-06-04. Reference: SHIP-2027-640.']),
    doc(1,'JSON',['"delivered_units": 96, "shipment_reference": "SHIP-2027-640"']),
  ]
  sources[1].name='URGENT-FRAUD-VERIFIED-INSTRUCTIONS.json'
  const findings=compareDocumentClaims(sources)
  assert.ok(findings.length>0)
  assert.doesNotMatch(JSON.stringify(findings),/URGENT-FRAUD|VERIFIED-INSTRUCTIONS/)
})
