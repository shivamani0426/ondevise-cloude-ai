import { useMemo, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { firebaseConfigured, supportsChromeOnDevice } from '../firebase'
import { analyzeEvidence, buildGraph, findSource, makeCloudPayload, makeLocalEvidencePlan, reportInvestigation, validateAIReview, validateLocalEvidenceSelection, inspectLocalEvidenceSelection, validatePrivacyCandidates } from './core'
import type { CaseFinding, EvidenceDocument, Investigation } from './core'
import { acceptedFileTypes, extractLocalFiles, validateFileSelection, MAX_FILES, MAX_FILE_BYTES } from './extract'
import { analyzeWithLocalModel, analyzeWithCloudModel } from './ai'
import { buildInvestigationSummary } from './summary'
import { evaluateEvidenceQuality } from './quality'
import { recordReview, currentReviews, explainDecision } from './reconciliation'
import type { ReviewDecision, ReviewEvent } from './reconciliation'
import { inspectPrivacy, cloudPrivacyGate } from './privacy'
import { filteredEvidenceGraph } from './graph-review'
import type { GraphScope } from './graph-review'
import { buildCaseExport, makeRedactedCaseJson } from './reports'
import './workspace.css'

type Busy = 'extract' | 'local' | 'cloud' | null

function saveText(filename: string, text: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const describeSize = (bytes: number) => (bytes / 1024).toFixed(1) + ' KB'
const describeError = (error: unknown) => error instanceof Error ? error.message : 'Unexpected processing error.'

export default function InvestigationWorkspace() {
  const [files, setFiles] = useState<File[]>([])
  const [documents, setDocuments] = useState<EvidenceDocument[]>([])
  const [investigation, setInvestigation] = useState<Investigation | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [status, setStatus] = useState('No document selected. Your files are processed in this browser.')
  const [error, setError] = useState('')
  const [selectedRef, setSelectedRef] = useState('')
  const [selectedFinding, setSelectedFinding] = useState('')
  const [editingRef, setEditingRef] = useState('')
  const [editedText, setEditedText] = useState('')
  const [localStatus, setLocalStatus] = useState('')
  const [localRaw, setLocalRaw] = useState('')
  const [cloudStatus, setCloudStatus] = useState('')
  const [modelDownload, setModelDownload] = useState(0)
  const [cloudPayload, setCloudPayload] = useState('')
  const [redactions, setRedactions] = useState(0)
  const [redactionTypes, setRedactionTypes] = useState<string[]>([])
  const [included, setIncluded] = useState(0)
  const [sparkConfirmed, setSparkConfirmed] = useState(false)
  const [payloadApproved, setPayloadApproved] = useState(false)
  const [cloudAttempted, setCloudAttempted] = useState(false)
  const [localAttempted, setLocalAttempted] = useState(false)
  const [localSensitive, setLocalSensitive] = useState<string[]>([])
  const [reviewHistory, setReviewHistory] = useState<ReviewEvent[]>([])
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision>('unresolved')
  const [reviewReason, setReviewReason] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [privacyReviewed, setPrivacyReviewed] = useState(false)
  const [graphScope, setGraphScope] = useState<GraphScope>('all')
  const [graphQuery, setGraphQuery] = useState('')
  const [graphSource, setGraphSource] = useState('')
  const [printPreview, setPrintPreview] = useState('')

  const graph = useMemo(() => investigation ? buildGraph(investigation) : null, [investigation])
  const graphView = useMemo(() => investigation ? filteredEvidenceGraph(investigation, graphScope, graphQuery, graphSource) : null, [investigation, graphScope, graphQuery, graphSource])
  const quality = useMemo(() => investigation ? evaluateEvidenceQuality(investigation) : null, [investigation])
  const privacy = useMemo(() => documents.length ? inspectPrivacy(documents) : null, [documents])
  const reviews = useMemo(() => investigation ? currentReviews(investigation, reviewHistory) : [], [investigation, reviewHistory])
  const exportData = useMemo(() => investigation ? buildCaseExport(investigation, reviewHistory, localSensitive) : null, [investigation, reviewHistory, localSensitive])
  const summary = useMemo(() => investigation ? buildInvestigationSummary(investigation) : null, [investigation])
  const detail = investigation?.findings.find(finding => finding.id === selectedFinding)
  const excerpt = findSource(documents, selectedRef)
  const cloudValidationError = cloudPayload ? cloudPrivacyGate(cloudPayload, documents, privacyReviewed) : null

  function chooseFiles(next: File[]) {
    if (busy) return
    try {
      validateFileSelection(next)
      setFiles(next)
      setDocuments([])
      setInvestigation(null)
      setReviewHistory([])
      setReviewReason('')
      setReviewError('')
      setPrintPreview('')
      setPrivacyReviewed(false)
      setSelectedRef('')
      setSelectedFinding('')
      setEditingRef('')
      setEditedText('')
      setLocalStatus('')
    setLocalRaw('')
      setCloudStatus('')
      setCloudPayload('')
      setLocalAttempted(false)
      setLocalSensitive([])
      setCloudAttempted(false)
      setSparkConfirmed(false)
      setPayloadApproved(false)
      setStatus(next.length + ' file(s) selected; no reading or inference has started.')
      setError('')
    } catch (reason) {
      setError(describeError(reason))
    }
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    if (selected.length) chooseFiles(selected)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!busy) chooseFiles(Array.from(event.dataTransfer.files))
  }

  async function extract() {
    if (busy || !files.length) return
    setBusy('extract')
    setError('')
    try {
      const extracted = await extractLocalFiles(files, setStatus)
      setDocuments(extracted)
      setFiles([])
      setInvestigation(null)
      setReviewHistory([])
      setPrintPreview('')
      setSelectedRef(extracted[0].id + ':' + extracted[0].segments[0].id)
      setStatus('Local extraction complete. ' + extracted.length + ' file(s), ' +
        extracted.reduce((sum, document) => sum + document.segments.length, 0) + ' anchored excerpts.')
    } catch (reason) {
      setDocuments([])
      setInvestigation(null)
      setStatus('Extraction unsuccessful. No partial results were accepted.')
      setError(describeError(reason))
    } finally {
      setBusy(null)
    }
  }

  function saveCorrection() {
    if (busy || !editingRef || !editedText.trim() || editedText.length > 3500) {
      setError('Enter a corrected excerpt between 1 and 3,500 characters.')
      return
    }
    setDocuments(previous => previous.map(doc => ({ ...doc, segments: doc.segments.map(segment =>
      doc.id + ':' + segment.id === editingRef ? { ...segment, text: editedText.trim() } : segment) })))
    setInvestigation(null)
    setReviewHistory([])
    setReviewReason('')
    setPrintPreview('')
    setPrivacyReviewed(false)
    setSelectedFinding('')
    setEditingRef('')
    setEditedText('')
    setCloudPayload('')
    setPayloadApproved(false)
    setSparkConfirmed(false)
    setLocalStatus('')
    setLocalRaw('')
    setLocalSensitive([])
    setCloudStatus('')
    setError('')
    setStatus('Correction saved only in browser memory. Re-run analysis to refresh all findings and graph links.')
  }

  function analyze() {
    if (busy || !documents.length) return
    const result = analyzeEvidence(documents)
    setInvestigation(result)
    setReviewHistory([])
    setReviewReason('')
    setReviewError('')
    setPrintPreview('')
    setSelectedFinding(result.findings[0]?.id || '')
    setLocalStatus('')
    setLocalRaw('')
    setCloudStatus('')
    setCloudPayload('')
    setLocalAttempted(false)
    setStatus('Evidence graph and ' + result.findings.length + ' rule-based findings created locally.')
    setError('')
  }

  async function localReview() {
    if (busy || !investigation || localAttempted) return
    setBusy('local')
    setLocalAttempted(true)
    setModelDownload(0)
    setLocalStatus('Preparing a compact local AI review. No cloud fallback is allowed.')
    setLocalRaw('')
    const startedAt = performance.now()
    try {
      const plan = makeLocalEvidencePlan(documents, investigation.findings)
      if (!plan.choices.length) {
        setLocalStatus('No readable source quotations fit the compact local prompt. Rule-based findings remain available.')
        return
      }
      const result = await analyzeWithLocalModel(plan.prompt, setModelDownload)
      setLocalRaw(result.text)
      const diagnostics = inspectLocalEvidenceSelection(result.text, documents, plan.choices, plan.focus)
      const grounded = validateLocalEvidenceSelection(result.text, documents, plan.choices, plan.focus)
      const proposedPrivate = validatePrivacyCandidates(result.text, documents)
      setLocalSensitive(proposedPrivate)
      // Any earlier cloud preview was built without these newly approved local
      // privacy suggestions. Invalidate its contents and prior consent.
      setCloudPayload('')
      setPrintPreview('')
      setPrivacyReviewed(false)
      setPayloadApproved(false)
      setSparkConfirmed(false)
      setCloudStatus('Local review finished. Prepare a new redacted cloud preview if you want an optional cloud analysis.')
      setInvestigation(previous => previous ? { ...previous, findings: [
        ...previous.findings.filter(finding => finding.origin !== 'on-device'), ...grounded,
      ] } : previous)
      const seconds = Math.round((performance.now() - startedAt) / 1000)
      setLocalStatus('Verified ' + result.source + ' after ' + seconds + ' seconds. ' + diagnostics.summary)
    } catch (reason) {
      setLocalStatus('Local AI review not completed: ' + describeError(reason) + '. No automatic cloud fallback.')
    } finally {
      setBusy(null)
    }
  }

  function prepareCloud() {
    if (busy || !investigation || !documents.length) return
    const prepared = makeCloudPayload(documents, localSensitive)
    if (!prepared.included) {
      setError('No excerpts fit the cloud payload limits. The cloud request was not prepared.')
      return
    }
    setCloudPayload(prepared.payload)
    setPrivacyReviewed(false)
    setRedactions(prepared.redactions)
    setRedactionTypes(prepared.categories)
    setIncluded(prepared.included)
    setSparkConfirmed(false)
    setPayloadApproved(false)
    setCloudStatus('Draft prepared locally. Nothing has been transmitted. Review/edit every character before approval.')
    setError('')
  }

  async function cloudReview() {
    if (busy || !investigation || !firebaseConfigured || !cloudPayload || cloudValidationError || !sparkConfirmed || !payloadApproved || cloudAttempted) return
    const exactPayload = cloudPayload
    setCloudAttempted(true)
    setBusy('cloud')
    setCloudStatus('Sending only the exact approved text shown above, once, to the Gemini Developer API.')
    try {
      const result = await analyzeWithCloudModel(exactPayload)
      const grounded = validateAIReview(result.text, documents, 'cloud')
      setInvestigation(previous => previous ? { ...previous, findings: [
        ...previous.findings.filter(finding => finding.origin !== 'cloud'), ...grounded,
      ] } : previous)
      setCloudStatus('Verified ' + result.source + '. ' + grounded.length + ' verbatim-source-quote selections accepted. ' +
        (grounded.length ? 'Inspect the quoted evidence; the AI has not established whether claims are true.' : 'The model response lacked exact source quotations and was not added to findings.'))
    } catch (reason) {
      setCloudStatus('Cloud review failed or was rejected: ' + (/free tier is not available/i.test(describeError(reason)) ? 'Gemini free-tier access is restricted for this project (403). Keep using the on-device and rule-based analysis; do not enable billing to bypass this restriction.' : describeError(reason)) + '. No automatic retry or fallback.')
    } finally {
      setBusy(null)
    }
  }

  function clearAll() {
    if (busy) return
    setFiles([])
    setDocuments([])
    setInvestigation(null)
    setSelectedRef('')
    setSelectedFinding('')
    setEditingRef('')
    setEditedText('')
    setLocalStatus('')
    setLocalRaw('')
    setCloudStatus('')
    setCloudPayload('')
    setPrivacyReviewed(false)
    setReviewHistory([])
    setReviewReason('')
    setReviewError('')
    setGraphScope('all')
    setGraphQuery('')
    setGraphSource('')
    setPrintPreview('')
    setSparkConfirmed(false)
    setPayloadApproved(false)
    setCloudAttempted(false)
    setLocalAttempted(false)
    setLocalSensitive([])
    setRedactions(0)
    setRedactionTypes([])
    setIncluded(0)
    setError('')
    setStatus('Case cleared from page memory. The browser has not saved your documents.')
  }

  function submitReview() {
    if (!investigation || busy) return
    try {
      const next = recordReview(investigation, reviewHistory, selectedFinding, reviewDecision, reviewReason)
      setReviewHistory(next)
      setReviewReason('')
      setReviewError('')
      setPrintPreview('')
    } catch (reason) { setReviewError(describeError(reason)) }
  }

  function selectFinding(finding: CaseFinding) {
    setSelectedFinding(finding.id)
    setSelectedRef(finding.refs[0] || '')
  }

  return (
    <div className="real-workspace">
      <div className="section-heading">
        <p className="eyebrow">PRIVATE ANALYSIS WORKSPACE · REAL DOCUMENTS</p>
        <h1>Document-to-evidence pipeline</h1>
        <p>Extract files locally, inspect cited evidence, build a conservative graph and findings, then optionally request AI review. No account, database, or automatic upload.</p>
      </div>

      <div className="case-steps" aria-label="Pipeline progress">
        <span className={documents.length ? 'done' : 'active'}>1 · Ingest</span>
        <span className={investigation ? 'done' : documents.length ? 'active' : ''}>2 · Analyze</span>
        <span className={investigation ? 'active' : ''}>3 · Trace findings</span>
        <span className={cloudAttempted ? 'done' : ''}>4 · Optional AI</span>
      </div>

      <section className="case-panel" aria-labelledby="upload-title">
        <div className="case-panel-top"><h2 id="upload-title">1. Ingest original documents</h2><span className="case-tag">Browser only</span></div>
        <div className="upload-drop" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
          <label htmlFor="evidence-upload" className="upload-label">Choose documents or drop them here</label>
          <input id="evidence-upload" type="file" multiple accept={acceptedFileTypes} onChange={onFileInput} disabled={Boolean(busy)}/>
          <p>PDF, DOCX, TXT, MD, CSV, JSON, PNG, JPEG. Up to {MAX_FILES} files, {Math.round(MAX_FILE_BYTES / 1024 / 1024)} MiB each (24 MiB combined).</p>
          <p>Scanned PDFs and images use local OCR. OCR language assets may be downloaded; document pixels are not uploaded. Unreadable excerpts are clearly marked for manual correction; failed file parsing is not silently skipped.</p>
        </div>
        {files.length > 0 && <div className="upload-selection"><strong>Selected for local extraction:</strong>{files.map((file, i) => <span key={i}>{file.name} · {describeSize(file.size)}</span>)}</div>}
        <div className="case-actions">
          <button className="primary-action" type="button" disabled={!files.length || Boolean(busy)} onClick={extract}>{busy === 'extract' ? 'Extracting on device…' : 'Extract selected files locally'}</button>
          <button className="outline-action" type="button" onClick={clearAll} disabled={Boolean(busy)}>Clear case from memory</button>
        </div>
        <p className="case-status" role="status">{status}</p>
        {error && <p className="case-error" role="alert">{error}</p>}
      </section>

      {documents.length > 0 && <section className="case-panel" aria-labelledby="documents-title">
        <div className="case-panel-top"><h2 id="documents-title">2. Inspect extracted evidence</h2><span className="case-tag">{documents.length} sources</span></div>
        <p className="case-caution">Extraction can lose layout, tables, handwriting and context. Verify quotations against the original documents. Your originals were never sent to Firebase.</p>
        <div className="source-list">
          {documents.map(doc => <article className="case-source" key={doc.id}>
            <div><strong>{doc.name}</strong><p>{doc.format} · {describeSize(doc.size)} · {doc.segments.length} referenced excerpts</p>
              {doc.warnings.map((warning, i) => <p className="case-warn" key={i}>{warning}</p>)}
            </div>
            <button className="outline-action" onClick={() => setSelectedRef(doc.id + ':' + doc.segments[0].id)}>Inspect first excerpt</button>
          </article>)}
        </div>
        {excerpt && <article className="case-excerpt">
          <div className="case-panel-top"><h3>Source excerpt: {excerpt.document.name}</h3><span>{excerpt.segment.anchor}</span></div>
          <p className="case-caution">Quoted locally extracted text, not independent verification of authenticity. Correct OCR or formatting mistakes here before analyzing.</p>
          <blockquote>{excerpt.segment.text}</blockquote>
          {editingRef === selectedRef ? <>
            <label className="case-editor-label" htmlFor="manual-excerpt-correction">Correct extracted excerpt locally</label>
            <textarea id="manual-excerpt-correction" className="case-payload" maxLength={3500} rows={5} value={editedText}
              onChange={event => setEditedText(event.target.value)} disabled={Boolean(busy)}/>
            <div className="case-actions"><button className="primary-action" onClick={saveCorrection} disabled={Boolean(busy) || !editedText.trim()}>Save correction and invalidate old analysis</button>
              <button className="outline-action" onClick={() => setEditingRef('')}>Cancel</button></div>
          </> : <button className="outline-action" type="button" disabled={Boolean(busy)} onClick={() => { setEditingRef(selectedRef); setEditedText(excerpt.segment.text) }}>Correct this excerpt</button>}
          <details><summary>Browse other anchors in this source</summary><div className="case-anchor-list">
            {excerpt.document.segments.map(segment => <button key={segment.id} type="button" onClick={() => { setEditingRef(''); setSelectedRef(excerpt.document.id + ':' + segment.id) }}>
              {segment.anchor} · {segment.text.slice(0, 100)}
            </button>)}
          </div></details>
        </article>}

        <button className="primary-action" type="button" disabled={Boolean(busy)} onClick={analyze}>Build evidence graph and findings</button>
      </section>}

      {investigation && <section className="case-panel" aria-labelledby="findings-title">
        <div className="case-panel-top"><h2 id="findings-title">3. Evidence graph and findings</h2><span className="case-tag">{investigation.entities.length} {investigation.entities.length === 1 ? 'entity' : 'entities'} · {investigation.findings.length} {investigation.findings.length === 1 ? 'finding' : 'findings'}</span></div>
        <p>Rule-based findings compare evidence across document categories, including explicit shared record references and differences in the same labelled field. Matching reference strings do NOT establish the same real-world event, authenticity or fraud. Different process stages or unsigned revisions require manual review. AI can only select literal quotations from extracted sources.</p>

        <div className="case-graph-tools" aria-label="Graph filters">
          <label htmlFor="graph-view-scope">Link type
            <select id="graph-view-scope" value={graphScope} onChange={event => setGraphScope(event.target.value as GraphScope)}>
              <option value="all">All traced links</option><option value="rules">Rule findings</option>
              <option value="ai">AI evidence selections</option>
            </select>
          </label>
          <label htmlFor="graph-source-filter">Trace one source
            <select id="graph-source-filter" value={graphSource} onChange={event => setGraphSource(event.target.value)}>
              <option value="">All sources</option>
              {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.id}</option>)}
            </select>
          </label>
          <label htmlFor="graph-search">Search visible labels
            <input id="graph-search" value={graphQuery} maxLength={80} placeholder="Reference or finding" onChange={event => setGraphQuery(event.target.value)}/>
          </label>
        </div>
        <p className="case-caution">Graph edges mean extracted source references, rule associations or AI-selected review cues—not authenticated real-world relationships.</p>
        {graphView && <div className="case-graph-map" aria-label="Interactive evidence graph">
          <svg className="case-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {graphView.edges.map((edge, i) => {
              const from = graph.nodes.find(node => node.id === edge.from)
              const to = graph.nodes.find(node => node.id === edge.to)
              return from && to ? <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}/> : null
            })}
          </svg>
          {graphView.nodes.map(node => <button key={node.id} type="button" className={'case-graph-node ' + node.kind}
            style={{ left: node.x + '%', top: node.y + '%' }}
            title={node.label}
            onClick={() => {
              if (node.findingId) {
                const item = investigation.findings.find(finding => finding.id === node.findingId)
                if (item) selectFinding(item)
              } else if (node.sourceId) {
                const doc = documents.find(document => document.id === node.sourceId)
                if (doc) setSelectedRef(doc.id + ':' + doc.segments[0].id)
              } else {
                const entity = investigation.entities.find(item => item.id === node.id)
                if (entity) setSelectedRef(entity.refs[0])
              }
            }}>{node.label}</button>)}
          <div className="case-graph-caption">Sources → Entities → Findings</div>
        </div>}
        <p className="case-caution">Accessible alternative: all graph relationships can be followed in the findings and cited excerpts below.</p>
        {graphView && <details className="case-explanation">
          <summary>Trace {graphView.edges.length} grounded graph links</summary>
          <ul className="case-trace-list">{graphView.edges.map((edge, index) => {
            const from = graphView.nodes.find(node => node.id === edge.from)
            const to = graphView.nodes.find(node => node.id === edge.to)
            return <li key={edge.from + ':' + edge.to + ':' + index}>{from?.label} → {to?.label} · {edge.basis}</li>
          })}</ul>
        </details>}
        <div className="case-findings">
          {investigation.findings.map(finding => <button key={finding.id} type="button"
            className={'case-finding ' + (selectedFinding === finding.id ? 'chosen' : '')}
            onClick={() => selectFinding(finding)}>
            <strong>{finding.title}</strong><span>{finding.status} · {finding.origin} · {finding.refs.length} cited excerpts</span>
          </button>)}
        </div>

        {detail && <article className="case-detail">
          <p className="eyebrow">SELECTED FINDING · {detail.status.toUpperCase()}</p>
          <h3>{detail.title}</h3>
          <p>{detail.detail}</p>
          {detail.quotes && <div className="case-verified-quotes">
            <strong>Literal text verified against extracted evidence</strong>
            {detail.quotes.map((item, index) => {
              const resolved = findSource(documents, item.ref)
              return <figure key={item.ref + '-' + index} className="case-evidence-quote">
                <blockquote>{item.quote}</blockquote>
                <figcaption>
                  <button type="button" className="inline-link" onClick={() => setSelectedRef(item.ref)}>
                    {resolved ? resolved.document.name + ' · ' + resolved.segment.anchor : item.ref}
                  </button>
                </figcaption>
              </figure>
            })}
            <p className="case-caution">Verbatim quotation matching confirms that the extracted text contains the phrase—not that the original document is authentic or that a model's interpretation is correct.</p>
          </div>}
          {detail.explanation && <details className="case-explanation">
            <summary>Why this finding was raised</summary>
            <p><strong>Evidence basis:</strong> {detail.explanation.basis}</p>
            <p><strong>Context check:</strong> {detail.explanation.context}</p>
            {detail.explanation.compared?.map((claim, index) => <p key={claim.ref + '-' + index}>
              <button className="inline-link" type="button" onClick={() => setSelectedRef(claim.ref)}>
                {claim.field}: {claim.value}
              </button>
            </p>)}
            <p className="case-caution"><strong>Limits:</strong> {detail.explanation.limitation}</p>
          </details>}
          <strong>Verification step</strong><p>{detail.nextStep}</p>
          <strong>Source citations</strong>
          <div className="case-citations">{detail.refs.map(ref => {
            const resolved = findSource(documents, ref)
            return <button key={ref} type="button" className="inline-link" onClick={() => setSelectedRef(ref)}>
              {resolved ? resolved.document.name + ' · ' + resolved.segment.anchor : ref}
            </button>
          })}</div>
        </article>}

      </section>}

      {investigation && <section className="case-panel" aria-labelledby="ai-review-title">
        <div className="case-panel-top"><h2 id="ai-review-title">4. Optional hybrid AI review</h2><span className="case-tag">Explicit actions only</span></div>
        <p>On-device evidence selection remains local and source-verifiable. Gemini cloud access is currently restricted for this project; do not assume the optional cloud route works. Source authenticity and interpretation still require human review.</p>

        {privacy && <div className="case-privacy-audit">
          <h3>Pipeline 12 · Privacy readiness</h3>
          <p>Local scan found {privacy.detectedOccurrences} recognizable sensitive-pattern occurrence(s) across {privacy.sourceCount} source(s). This count is not a guarantee of complete masking.</p>
          <p><strong>Detected categories:</strong> {privacy.detectedCategories.join(', ') || 'None detected by current patterns'}</p>
          <details><summary>Privacy limitations and controls</summary><ul>{privacy.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>
        </div>}
        <div className="case-model-section">
          <h3>A. On-device Firebase AI Logic</h3>
          <p>Uses Chrome's local model. To reduce CPU/GPU load, it receives up to six numbered, source-grounded quotation choices (maximum 2,400 prompt characters). The model returns choice IDs, not newly written quotations. PhantomGraph independently checks each ID and the original source text. For cases with a multi-source rule finding, the choices focus on its cited evidence; model selections still do not establish relevance or truth. The full rule-based investigation examines all extracted sources. Firebase stays <code>ONLY_ON_DEVICE</code>, with no cloud fallback.</p>
          <button className="outline-action" type="button" disabled={Boolean(busy) || !firebaseConfigured || !supportsChromeOnDevice() || localAttempted} onClick={localReview}>
            {busy === 'local' ? 'Local model analyzing…' : localAttempted ? 'Local review attempted' : 'Review case with on-device AI'}
          </button>
          {modelDownload > 0 && modelDownload < 1 && <p>Local model download: {Math.round(modelDownload * 100)}%</p>}
          {localStatus && <p className="case-status" role="status">{localStatus}</p>}
          {localRaw && <details className="case-excerpt"><summary>Inspect local model response (may contain private text)</summary>
            <p className="case-caution">This response stays in page memory. Do not share it if your documents contain personal information.</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 280, overflowY: 'auto', fontSize: 12 }}>{localRaw}</pre>
          </details>}
          {!supportsChromeOnDevice() && <p className="case-warn">Local AI requires Chrome desktop. Rule analysis and cloud review do not.</p>}
        </div>

        <div className="case-model-section">
          <h3>B. Optional Gemini cloud review</h3>
          <p>Cloud analysis is <strong>off by default</strong> and free-tier access is currently restricted for this project (403). You can inspect the local redacted preview without sending it. Automatic redaction can miss names or private context; never approve a payload you have not read. If cloud access is legitimately restored, only the explicitly approved text is sent once.</p>
          <button className="outline-action" disabled={Boolean(busy) || cloudAttempted} type="button" onClick={prepareCloud}>
            Prepare locally redacted cloud preview
          </button>
          {cloudPayload && <>
            <p className="case-caution">Preview includes {included} anchored excerpts and {redactions} automatic redactions{redactionTypes.length ? ' (' + redactionTypes.join(', ') + ')' : ''}. The source filenames are excluded. Check for names, addresses, financial identifiers, secrets and anything you do not want to transmit.</p>
            <label className="case-editor-label" htmlFor="approved-cloud-payload">Exact cloud request text (editable)</label>
            <textarea id="approved-cloud-payload" className="case-payload" value={cloudPayload} rows={12} maxLength={16000}
              onChange={event => { setCloudPayload(event.target.value); setPayloadApproved(false); setPrivacyReviewed(false); setSparkConfirmed(false); setCloudStatus('Preview changed. Review and approve again before sending.') }}
              disabled={Boolean(busy) || cloudAttempted} spellCheck={false}/>
            {cloudValidationError && <p className="case-error" role="alert">Cloud payload blocked: {cloudValidationError}</p>}
            <label className="case-checkbox"><input type="checkbox" checked={privacyReviewed} disabled={Boolean(busy) || cloudAttempted}
              onChange={event => setPrivacyReviewed(event.target.checked)}/> I independently inspected the exact payload for names, addresses, secret values, and private context that automated masking may miss.</label>
            <label className="case-checkbox"><input type="checkbox" checked={sparkConfirmed} disabled={Boolean(busy) || cloudAttempted}
              onChange={event => setSparkConfirmed(event.target.checked)}/> I verified Firebase Spark (free) and that no billing account is linked.</label>
            <label className="case-checkbox"><input type="checkbox" checked={payloadApproved} disabled={Boolean(busy) || cloudAttempted}
              onChange={event => setPayloadApproved(event.target.checked)}/> I reviewed every character above and explicitly approve sending only this text to Gemini Developer API.</label>
            <button className="primary-action" type="button"
              disabled={Boolean(busy) || cloudAttempted || !firebaseConfigured || !sparkConfirmed || !privacyReviewed || !payloadApproved || Boolean(cloudValidationError)}
              onClick={cloudReview}>{busy === 'cloud' ? 'Sending approved request…' : cloudAttempted ? 'Cloud request attempted (no automatic retry)' : 'Send this exact approved payload once'}</button>
          </>}
          {cloudStatus && <p className="case-status" role="status">{cloudStatus}</p>}
        </div>
      </section>}

      {summary && <section className="case-panel case-summary" aria-labelledby="summary-title">
        <div className="case-panel-top">
          <h2 id="summary-title">Investigation summary</h2>
          <span className="case-tag">{summary.status}</span>
        </div>
        <p className="case-caution">Local, source-grounded synthesis. No new AI claims, cloud request, authenticity assessment, or fraud verdict.</p>
        <div className="case-summary-metrics">
          <span><strong>{summary.sourceCount}</strong> sources</span>
          <span><strong>{summary.entityCount}</strong> entities</span>
          <span><strong>{summary.ruleFindingCount}</strong> rule findings</span>
          <span><strong>{summary.aiEvidenceGroupCount}</strong> AI evidence groups (separate)</span>
        </div>
        <p>{summary.overview}</p>
        {summary.findings.length ? summary.findings.map(item => <article key={item.id} className="case-summary-detail">
          <h3>{item.title}</h3>
          <p><strong>{item.status}</strong> · {item.explanation}</p>
          <p><strong>Context:</strong> {item.context}</p>
          {item.compared.length > 0 && <div className="case-summary-values">
            {item.compared.map((claim, index) => <button key={claim.ref + ':' + index} className="inline-link" type="button" onClick={() => setSelectedRef(claim.ref)}>
              Extracted {claim.field}: {claim.value}
            </button>)}
          </div>}
          <p><strong>Verification step:</strong> {item.nextStep}</p>
          <div className="case-summary-citations">{item.citations.map(citation =>
            <button key={citation.ref} className="inline-link" type="button" onClick={() => setSelectedRef(citation.ref)}>
              {citation.documentId} · {citation.anchor}
            </button>)}</div>
        </article>) : <p>No source-linked rule findings were detected. This does not establish that the documents are reliable.</p>}
        <details className="case-explanation"><summary>Investigation limitations</summary>
          <ul>{summary.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul>
        </details>
      </section>}

      {quality && <section className="case-panel" aria-labelledby="quality-title">
        <div className="case-panel-top"><h2 id="quality-title">Pipeline 10 · Evidence quality and confidence</h2><span className="case-tag">No fraud score</span></div>
        <p className="case-caution">Quality labels describe extracted evidence completeness and citation coverage, not the probability of fraud or correctness.</p>
        <p>{quality.coveredSourceCount} of {quality.totalSourceCount} sources have an excerpt cited by a current finding.</p>
        <div className="case-quality-list">
          {quality.sources.map(source=><article key={source.id} className="case-quality-item">
            <strong>{source.id} · {source.format} · {source.level}</strong>
            <p>{source.excerpts} excerpts · {source.citedExcerpts} cited excerpts</p>
            {source.notes.map(note=><p className="case-caution" key={note}>{note}</p>)}
          </article>)}
        </div>
        {quality.findings.map(finding=><details key={finding.id} className="case-explanation">
          <summary>{finding.title} · {finding.level}</summary>
          <p>{finding.citedSources} distinct source(s) · {finding.citedExcerpts} citation(s)</p>
          <ul>{finding.notes.map(note=><li key={note}>{note}</li>)}</ul>
        </details>)}
      </section>}

      {investigation && <section className="case-panel" aria-labelledby="reconcile-title">
        <div className="case-panel-top"><h2 id="reconcile-title">Pipeline 11 · Reconciliation workspace</h2><span className="case-tag">{reviews.length} reviewed finding(s)</span></div>
        <p className="case-caution">Decisions are user-reported and retained only in page memory. “Verified” means an investigator claims external verification; PhantomGraph does not authenticate records.</p>
        <label className="case-editor-label" htmlFor="review-finding">Rule-based finding to review</label>
        <select id="review-finding" className="case-control" value={investigation.findings.some(f=>f.id===selectedFinding && f.origin==='rules') ? selectedFinding : ''}
          onChange={event => setSelectedFinding(event.target.value)}>
          <option value="">Choose a rule finding</option>
          {investigation.findings.filter(f=>f.origin==='rules' && f.title!=='No rule-matched concern found').map(f=><option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
        <label className="case-editor-label" htmlFor="review-decision">Investigator disposition</label>
        <select id="review-decision" className="case-control" value={reviewDecision} onChange={event => setReviewDecision(event.target.value as ReviewDecision)}>
          <option value="unresolved">Unresolved</option><option value="explained">Explained by investigator</option>
          <option value="verified">Externally verified by investigator</option><option value="dismissed">Dismissed by investigator</option>
        </select>
        <label className="case-editor-label" htmlFor="review-reason">Reason and original-record verification steps (required)</label>
        <textarea id="review-reason" className="case-payload" rows={3} maxLength={500} value={reviewReason}
          onChange={event=>setReviewReason(event.target.value)} placeholder="Describe which originals or amendments you inspected and what remains uncertain."/>
        <button className="primary-action" type="button" disabled={Boolean(busy) || !selectedFinding || !investigation.findings.some(f=>f.id===selectedFinding && f.origin==='rules' && f.title!=='No rule-matched concern found') || reviewReason.trim().length<12}
          onClick={submitReview}>Record investigator decision locally</button>
        {reviewError && <p className="case-error" role="alert">{reviewError}</p>}
        <div className="case-review-history" aria-label="Investigator decision history">
          {reviewHistory.length ? reviewHistory.map(event=><article key={event.sequence} className="case-quality-item">
            <strong>#{event.sequence} · {event.findingId} · {event.decision}</strong>
            <p>{event.recordedAt} · {event.reason}</p>
            <p className="case-caution">{explainDecision(event.decision)} Cited anchors: {event.sourceRefs.join(', ')}</p>
          </article>) : <p>No manual reconciliation decisions have been recorded.</p>}
        </div>
      </section>}

      {investigation && <section className="case-panel" aria-labelledby="report-title">
        <div className="case-panel-top"><h2 id="report-title">5. Export or delete case</h2><span className="case-tag">No server storage</span></div>
        <p>Download a redacted local text report with document IDs, findings and source anchors. Original filenames are omitted. Automatic masking is incomplete, so read the report before sharing.</p>
        <div className="case-actions">
          <button className="primary-action" onClick={() => saveText('phantomgraph-redacted-report.txt', reportInvestigation(investigation, localSensitive))} disabled={Boolean(busy)}>Download redacted investigation report</button>
          <button className="outline-action" type="button" disabled={Boolean(busy)} onClick={()=>saveText('phantomgraph-structured-investigation.json', makeRedactedCaseJson(investigation, reviewHistory, localSensitive), 'application/json;charset=utf-8')}>Download structured JSON case report</button>
          <button className="outline-action" type="button" disabled={Boolean(busy)} onClick={()=>setPrintPreview(exportData?.redactedReport || '')}>Prepare privacy-reviewed PDF preview</button>
          <button className="outline-action" onClick={clearAll} disabled={Boolean(busy)}>Clear case from memory</button>
        </div>
        {printPreview && <div className="case-report-preview">
          <h3>Pipeline 14 · Print / Save as PDF</h3>
          <p className="case-caution">Inspect this entire redacted preview before printing. The browser Print dialog can save it as PDF. No report is uploaded and automatic masking remains incomplete.</p>
          <pre className="case-report-text">{printPreview}</pre>
          <button className="primary-action" type="button" onClick={()=>window.print()}>Print / Save as PDF</button>
          <button className="outline-action" type="button" onClick={()=>setPrintPreview('')}>Close preview</button>
        </div>}
      </section>}
      {printPreview && <section className="case-print-document" aria-label="Printable privacy-reviewed investigation report">
        <h1>PhantomGraph AI · Local investigation report</h1>
        <pre>{printPreview}</pre>
      </section>}
      <p className="case-disclaimer">PhantomGraph is an investigative aid, not a forensic identity check, legal judgment, or definitive fraud detector. No account or server-side document storage is used. Closing or refreshing this page clears the current in-memory case.</p>
    </div>
  )
}
