import { useMemo, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { firebaseConfigured, supportsChromeOnDevice } from '../firebase'
import { analyzeEvidence, buildGraph, findSource, makeCloudPayload, makeLocalPrompt, reportInvestigation, validateAIReview, validatePrivacyCandidates } from './core'
import type { CaseFinding, EvidenceDocument, Investigation } from './core'
import { acceptedFileTypes, extractLocalFiles, validateFileSelection, MAX_FILES, MAX_FILE_BYTES } from './extract'
import { analyzeWithLocalModel, analyzeWithCloudModel } from './ai'
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

  const graph = useMemo(() => investigation ? buildGraph(investigation) : null, [investigation])
  const detail = investigation?.findings.find(finding => finding.id === selectedFinding)
  const excerpt = findSource(documents, selectedRef)

  function chooseFiles(next: File[]) {
    if (busy) return
    try {
      validateFileSelection(next)
      setFiles(next)
      setDocuments([])
      setInvestigation(null)
      setSelectedRef('')
      setSelectedFinding('')
      setEditingRef('')
      setEditedText('')
      setLocalStatus('')
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
    setSelectedFinding('')
    setEditingRef('')
    setEditedText('')
    setCloudPayload('')
    setPayloadApproved(false)
    setSparkConfirmed(false)
    setLocalStatus('')
    setLocalSensitive([])
    setCloudStatus('')
    setError('')
    setStatus('Correction saved only in browser memory. Re-run analysis to refresh all findings and graph links.')
  }

  function analyze() {
    if (busy || !documents.length) return
    const result = analyzeEvidence(documents)
    setInvestigation(result)
    setSelectedFinding(result.findings[0]?.id || '')
    setLocalStatus('')
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
    setLocalStatus('Preparing local Firebase AI Logic model. Cloud fallback is disabled.')
    try {
      const result = await analyzeWithLocalModel(makeLocalPrompt(documents), setModelDownload)
      const grounded = validateAIReview(result.text, documents, 'on-device')
      const proposedPrivate = validatePrivacyCandidates(result.text, documents)
      setLocalSensitive(proposedPrivate)
      setInvestigation(previous => previous ? { ...previous, findings: [
        ...previous.findings.filter(finding => finding.origin !== 'on-device'), ...grounded,
      ] } : previous)
      setLocalStatus('Verified ' + result.source + '. ' + grounded.length + ' source-grounded AI hypotheses and ' + proposedPrivate.length + ' literal privacy candidates accepted. ' +
        (grounded.length ? 'Review every citation.' : 'Other output was rejected because its source references or JSON structure could not be verified.'))
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
    setRedactions(prepared.redactions)
    setRedactionTypes(prepared.categories)
    setIncluded(prepared.included)
    setSparkConfirmed(false)
    setPayloadApproved(false)
    setCloudStatus('Draft prepared locally. Nothing has been transmitted. Review/edit every character before approval.')
    setError('')
  }

  async function cloudReview() {
    if (busy || !investigation || !firebaseConfigured || !cloudPayload || !sparkConfirmed || !payloadApproved || cloudAttempted) return
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
      setCloudStatus('Verified ' + result.source + '. ' + grounded.length + ' source-grounded cloud hypotheses accepted. ' +
        (grounded.length ? 'Review every citation.' : 'Model output did not contain safely verifiable cited findings.'))
    } catch (reason) {
      setCloudStatus('Cloud review failed or was rejected: ' + describeError(reason) + '. No automatic retry or fallback.')
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
    setCloudStatus('')
    setCloudPayload('')
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
        <div className="case-panel-top"><h2 id="findings-title">3. Evidence graph and findings</h2><span className="case-tag">{investigation.entities.length} entities · {investigation.findings.length} findings</span></div>
        <p>These are evidence-linked review cues, not certified fraud judgments. AI suggestions, when present, are explicitly labelled unverified.</p>

        {graph && <div className="case-graph-map" aria-label="Interactive evidence graph">
          <svg className="case-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {graph.edges.map((edge, i) => {
              const from = graph.nodes.find(node => node.id === edge.from)
              const to = graph.nodes.find(node => node.id === edge.to)
              return from && to ? <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}/> : null
            })}
          </svg>
          {graph.nodes.map(node => <button key={node.id} type="button" className={'case-graph-node ' + node.kind}
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
        <p>Both inference routes were separately verified with fictional connectivity probes. Case analysis has its own limitations; AI proposals are added only if their citations match extracted source anchors.</p>

        <div className="case-model-section">
          <h3>A. On-device Firebase AI Logic</h3>
          <p>Uses Chrome's local model. File excerpts stay on the device; the model is constrained to <code>ONLY_ON_DEVICE</code>, with no fallback. A failed JSON or citation check cannot overwrite the rule-based findings.</p>
          <button className="outline-action" type="button" disabled={Boolean(busy) || !firebaseConfigured || !supportsChromeOnDevice() || localAttempted} onClick={localReview}>
            {busy === 'local' ? 'Local model analyzing…' : localAttempted ? 'Local review attempted' : 'Review case with on-device AI'}
          </button>
          {modelDownload > 0 && modelDownload < 1 && <p>Local model download: {Math.round(modelDownload * 100)}%</p>}
          {localStatus && <p className="case-status" role="status">{localStatus}</p>}
          {!supportsChromeOnDevice() && <p className="case-warn">Local AI requires Chrome desktop. Rule analysis and cloud review do not.</p>}
        </div>

        <div className="case-model-section">
          <h3>B. Optional Gemini cloud review</h3>
          <p>Cloud analysis is <strong>off by default</strong>. Prepare a redacted preview and edit it. Automatic redaction cannot detect all private names or context; never approve a payload you have not read. Only the text in the editor will be sent, once, after explicit consent.</p>
          <button className="outline-action" disabled={Boolean(busy) || cloudAttempted} type="button" onClick={prepareCloud}>
            Prepare locally redacted cloud preview
          </button>
          {cloudPayload && <>
            <p className="case-caution">Preview includes {included} anchored excerpts and {redactions} automatic redactions{redactionTypes.length ? ' (' + redactionTypes.join(', ') + ')' : ''}. The source filenames are excluded. Check for names, addresses, financial identifiers, secrets and anything you do not want to transmit.</p>
            <label className="case-editor-label" htmlFor="approved-cloud-payload">Exact cloud request text (editable)</label>
            <textarea id="approved-cloud-payload" className="case-payload" value={cloudPayload} rows={12} maxLength={16000}
              onChange={event => { setCloudPayload(event.target.value); setPayloadApproved(false); setCloudStatus('Preview changed. Review and approve again before sending.') }}
              disabled={Boolean(busy) || cloudAttempted} spellCheck={false}/>
            <label className="case-checkbox"><input type="checkbox" checked={sparkConfirmed} disabled={Boolean(busy) || cloudAttempted}
              onChange={event => setSparkConfirmed(event.target.checked)}/> I verified Firebase Spark (free) and that no billing account is linked.</label>
            <label className="case-checkbox"><input type="checkbox" checked={payloadApproved} disabled={Boolean(busy) || cloudAttempted}
              onChange={event => setPayloadApproved(event.target.checked)}/> I reviewed every character above and explicitly approve sending only this text to Gemini Developer API.</label>
            <button className="primary-action" type="button"
              disabled={Boolean(busy) || cloudAttempted || !firebaseConfigured || !sparkConfirmed || !payloadApproved || cloudPayload.length < 150}
              onClick={cloudReview}>{busy === 'cloud' ? 'Sending approved request…' : cloudAttempted ? 'Cloud request attempted (no automatic retry)' : 'Send this exact approved payload once'}</button>
          </>}
          {cloudStatus && <p className="case-status" role="status">{cloudStatus}</p>}
        </div>
      </section>}

      {investigation && <section className="case-panel" aria-labelledby="report-title">
        <div className="case-panel-top"><h2 id="report-title">5. Export or delete case</h2><span className="case-tag">No server storage</span></div>
        <p>Download a redacted local text report with document IDs, findings and source anchors. Original filenames are omitted. Automatic masking is incomplete, so read the report before sharing.</p>
        <div className="case-actions">
          <button className="primary-action" onClick={() => saveText('phantomgraph-redacted-report.txt', reportInvestigation(investigation, localSensitive))} disabled={Boolean(busy)}>Download redacted investigation report</button>
          <button className="outline-action" onClick={clearAll} disabled={Boolean(busy)}>Clear case from memory</button>
        </div>
      </section>}
      <p className="case-disclaimer">PhantomGraph is an investigative aid, not a forensic identity check, legal judgment, or definitive fraud detector. No account or server-side document storage is used. Closing or refreshing this page clears the current in-memory case.</p>
    </div>
  )
}
