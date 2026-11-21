import assert from 'node:assert/strict'
import test from 'node:test'
import { evidence, findings, nodes, edges, reportText } from '../src/demo.ts'

test('each finding and graph edge resolves to existing sample evidence', () => {
  const ids = new Set(evidence.map(item => item.id))
  assert.equal(ids.size, 3)
  assert.equal(findings.length, 4)
  assert.equal(nodes.length, 5)
  assert.ok(edges.length >= 4)
  for (const finding of findings) {
    assert.ok(finding.evidenceIds.length > 0)
    for (const id of finding.evidenceIds) assert.ok(ids.has(id), 'Missing source ' + id)
    assert.ok(finding.description.length > 30)
    assert.ok(finding.nextStep.length > 30)
  }
  for (const [from, to] of edges) {
    assert.ok(nodes[from], 'Unknown graph from-node ' + from)
    assert.ok(nodes[to], 'Unknown graph to-node ' + to)
  }
  for (const node of nodes) assert.ok(findings.some(finding => finding.id === node.finding))
})

test('report includes citations, uncertainty, and no false inference claims', () => {
  const report = reportText()
  for (const source of evidence) assert.ok(report.includes(source.name))
  for (const finding of findings) assert.ok(report.includes(finding.title))
  assert.match(report, /not a legal, criminal, or definitive fraud determination/)
  assert.match(report, /No cloud or on-device AI inference was performed/)
})
