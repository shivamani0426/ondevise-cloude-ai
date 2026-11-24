import type { Investigation, CaseGraph } from './core.ts'
import { buildGraph } from './core.ts'

export type GraphScope = 'all' | 'rules' | 'ai' | 'sources'
export type EvidenceGraphView = {
  nodes: CaseGraph['nodes']
  edges: Array<{ from: string; to: string; basis: 'extracted source reference' | 'rule association' | 'AI-selected review association' }>
}

/** Pipeline 13: filter existing grounded edges. Never invent an edge or an identity. */
export function filteredEvidenceGraph(
  investigation: Investigation,
  scope: GraphScope = 'all',
  search = '',
  sourceId = '',
): EvidenceGraphView {
  const graph = buildGraph(investigation)
  const findings = new Map(investigation.findings.map(f=>[f.id,f]))
  const all = graph.nodes.filter(node => {
    if (node.kind !== 'finding') return true
    const finding = findings.get(node.findingId || '')
    if (!finding) return false
    return scope === 'all' || scope === 'sources' ||
      (scope === 'rules' && finding.origin === 'rules') ||
      (scope === 'ai' && finding.origin !== 'rules')
  })
  const candidateIds = new Set(all.map(n=>n.id))
  const edges = graph.edges.filter(e=>candidateIds.has(e.from)&&candidateIds.has(e.to))
  const query = search.trim().toLowerCase().slice(0,80)
  const seed = new Set(all.filter(node =>
    (!query || node.label.toLowerCase().includes(query)) &&
    (!sourceId || node.sourceId === sourceId || node.kind !== 'source')
  ).map(n=>n.id))
  if (sourceId) {
    // Traverse from a selected source via REAL graph edges only.
    seed.clear()
    if(candidateIds.has(sourceId)) seed.add(sourceId)
    for (let pass=0;pass<2;pass++) for (const edge of edges) {
      if (seed.has(edge.from)) seed.add(edge.to)
    }
    if (query) for(const node of all) if(seed.has(node.id) && !node.label.toLowerCase().includes(query)) seed.delete(node.id)
  }
  const selected = !query && !sourceId ? candidateIds : new Set(seed)
  if (query && !sourceId) for(const e of edges) {
    if(seed.has(e.from)||seed.has(e.to)) { selected.add(e.from); selected.add(e.to) }
  }
  const nodes = all.filter(n=>selected.has(n.id))
  const keep = new Set(nodes.map(n=>n.id))
  return {
    nodes,
    edges: edges.filter(e=>keep.has(e.from)&&keep.has(e.to)).map(e=>{
      const to=graph.nodes.find(n=>n.id===e.to)
      const origin=to?.findingId ? findings.get(to.findingId)?.origin : null
      const basis=e.from.startsWith('source-') && to?.kind === 'entity'
        ? 'extracted source reference' as const :
        origin && origin !== 'rules' ? 'AI-selected review association' as const : 'rule association' as const
      return { ...e, basis }
    }),
  }
}
