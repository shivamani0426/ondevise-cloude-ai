import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalGuard } from '../src/pipeline/local-runtime.ts'
import { relateEvidence } from '../src/pipeline/relationships.ts'
import { findSource } from '../src/pipeline/core.ts'

test('local guard times out, prevents overlap, ignores stale work and permits retry after settlement', async () => {
  const run = createLocalGuard()
  let finish
  let active
  const pending = run(check => {
    active = check
    return new Promise(resolve => { finish = resolve })
  }, 10)
  await assert.rejects(pending, /timed out/)
  assert.equal(active(), false)
  await assert.rejects(run(async () => 'overlap'), /previous local operation/)
  finish('late')
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(await run(async () => 'retry'), 'retry')
})
test('local guard recovers after an SDK rejection', async () => {
  const run = createLocalGuard()
  await assert.rejects(run(async () => { throw Error('SDK failed') }), /SDK failed/)
  assert.equal(await run(async () => 42), 42)
})
const doc = (id, lines) => ({id, name: id+'.txt', format:'TXT', size:lines.join('').length, warnings:[], segments:lines.map((text,i)=>({id:'a-'+i,anchor:'line '+(i+1),text}))})
const concerns = docs => relateEvidence(docs).filter(f=>f.status==='Possible concern')
for (const [family, ref] of [['claim','CLM-2030-101'],['application','APP-2030-101'],['policy','POL-2030-101'],['contract','CTR-2030-101'],['order','ORD-2030-101'],['invoice','INV-2030-101'],['transaction','TXN-2030-101']]) {
  test(family+' narrative and labelled aliases retain traceable differences and accept matching controls',()=>{
    const a=doc('source-1',[family+' ID '+ref+' has an issue date of 2030-01-02.'])
    const b=doc('source-2',[family+' ID: '+ref,'date_of_issue: 2030-01-03'])
    const findings=concerns([a,b])
    assert.equal(findings.length,1)
    for(const ref of findings[0].refs) assert.ok(findSource([a,b],ref))
    const good=doc('source-2',[family+' ID: '+ref,'date_of_issue: 2030-01-02'])
    assert.equal(concerns([a,good]).length,0)
  })
}
test('no guessing incomplete identities, conditions, or different stages',()=>{
  const a=doc('source-1',['Invoice ID INV-2030-101 has an amount of USD 300.'])
  const partial=doc('source-2',['Invoice ID: INV-2030','amount: USD 400'])
  assert.equal(concerns([a,partial]).length,0)
  const conditional=doc('source-2',['Invoice ID INV-2030-101 has an amount of USD 400 if approved.'])
  assert.equal(concerns([a,conditional]).length,0)
  const different=doc('source-2',['Invoice ID: INV-2030-101','paid_amount: USD 400'])
  assert.equal(concerns([a,different]).length,0)
})

test('explicit masked identifier produces a hypothesis, never a value comparison',()=>{
  const a=doc('source-1',['Invoice ID: INV-2030-1234','amount: USD 300'])
  const b=doc('source-2',['Invoice ID ending in 1234','amount: USD 400'])
  const findings=relateEvidence([a,b])
  assert.equal(findings.length,1)
  assert.equal(findings[0].status,'Unverified hypothesis')
  assert.equal(findings[0].title,'Incomplete reference needs verification')
  assert.equal(findings[0].explanation.compared,undefined)
  for(const ref of findings[0].refs) assert.ok(findSource([a,b],ref))
  const c=doc('source-3',['Invoice ID: INV-2031-1234'])
  assert.equal(relateEvidence([a,b,c]).length,0)
  const other=doc('source-2',['Shipment ID ending in 1234'])
  assert.equal(relateEvidence([a,other]).length,0)
  const vague=doc('source-2',['The number ends in 1234.'])
  assert.equal(relateEvidence([a,vague]).length,0)
})

test('masked X-prefix identifiers never become full identity matches',()=>{
  const a=doc('source-1',['Invoice ID: INV-2030-1234','amount: USD 300'])
  const b=doc('source-2',['Invoice ID: XXXX1234','amount: USD 400'])
  const c=doc('source-3',['Invoice ID: XXXX1234','amount: USD 500'])
  assert.equal(relateEvidence([b,c]).length,0)
  const cues=relateEvidence([a,b])
  assert.equal(cues.length,1)
  assert.equal(cues[0].title,'Incomplete reference needs verification')
  assert.equal(cues[0].status,'Unverified hypothesis')
  assert.equal(concerns([a,b,c]).length,0)
})
