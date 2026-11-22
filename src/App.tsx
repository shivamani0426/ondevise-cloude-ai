import { useEffect, useRef, useState } from 'react'
import { evidence, findings, nodes, edges, reportText, type Finding } from './demo'
import { firebaseConfigured, verifyAppCheck, runDeviceProbe, runCloudProbe, supportsChromeOnDevice } from './firebase'
import InvestigationWorkspace from './pipeline/Workspace'

type Section = 'overview' | 'workspace' | 'evidence' | 'findings' | 'investigation' | 'report'
const sections: { key: Section; name: string }[] = [
  { key: 'overview', name: 'Overview' },
  { key: 'workspace', name: 'Analyze Documents' },
  { key: 'evidence', name: 'Evidence (3)' },
  { key: 'findings', name: 'Findings (4)' },
  { key: 'investigation', name: 'Investigation' },
  { key: 'report', name: 'Report / Export' },
]

function statusClass(status: Finding['status']) {
  return status === 'Possible concern' ? 'caution' : status === 'Corroborated conflict' ? 'verified' : 'unknown'
}

export default function App() {
  const [section, setSection] = useState<Section>('investigation')
  const [selectedFinding, setSelectedFinding] = useState('fee')
  const [selectedEvidence, setSelectedEvidence] = useState('email')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [appCheckResult, setAppCheckResult] = useState('')
  const [checkingAppCheck, setCheckingAppCheck] = useState(false)
  const [probeRunning, setProbeRunning] = useState<'device' | 'cloud' | null>(null)
  const [deviceResult, setDeviceResult] = useState('')
  const [cloudResult, setCloudResult] = useState('')
  const [deviceDownloadProgress, setDeviceDownloadProgress] = useState(0)
  const [sparkConfirmed, setSparkConfirmed] = useState(false)
  const [cloudProbeAttempted, setCloudProbeAttempted] = useState(false)
  const canUseOnDevice = supportsChromeOnDevice()
  const dialogRef = useRef<HTMLDivElement>(null)
  const currentFinding = findings.find((finding) => finding.id === selectedFinding) || findings[0]
  const currentEvidence = evidence.find((item) => item.id === selectedEvidence) || evidence[0]

  // Escape and Tab behavior is required for the already-existing source dialog.
  useEffect(() => {
    if (!sourceOpen) return
    const oldFocus = document.activeElement
    const dialog = dialogRef.current
    const buttons = dialog ? Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')) : []
    buttons[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSourceOpen(false)
      } else if (event.key === 'Tab' && buttons.length) {
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (oldFocus instanceof HTMLElement && oldFocus.isConnected) oldFocus.focus()
    }
  }, [sourceOpen])

  function selectFinding(id: string, preferredEvidenceId?: string) {
    const finding = findings.find((item) => item.id === id)
    if (!finding) return
    setSelectedFinding(id)
    setSelectedEvidence(preferredEvidenceId && finding.evidenceIds.includes(preferredEvidenceId) ? preferredEvidenceId : finding.evidenceIds[0])
    setSourceOpen(false)
  }

  function openEvidence(id: string) {
    setSelectedEvidence(id)
    setSourceOpen(true)
  }

  function downloadReport() {
    const blob = new Blob([reportText()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'phantomgraph-fictional-case-01.txt'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function testAttestation() {
    setCheckingAppCheck(true)
    try { setAppCheckResult(await verifyAppCheck()) } finally { setCheckingAppCheck(false) }
  }

  async function testDeviceInference() {
    setProbeRunning('device')
    setDeviceDownloadProgress(0)
    setDeviceResult('Preparing the on-device model. No cloud fallback is allowed.')
    try {
      // runDeviceProbe initializes the local model from this direct button activation.
      const result = await runDeviceProbe(setDeviceDownloadProgress)
      setDeviceResult('Verified ' + result.source + ' inference. Model replied: ' + result.text)
    } catch (error) {
      setDeviceResult('On-device inference not verified: ' + (error instanceof Error ? error.message : 'Unknown error') + '. No cloud fallback was attempted.')
    } finally {
      setProbeRunning(null)
    }
  }

  async function testCloudInference() {
    if (!sparkConfirmed || cloudProbeAttempted) return
    setCloudProbeAttempted(true)
    setProbeRunning('cloud')
    setCloudResult('Sending one fixed fictional test prompt, not case evidence.')
    try {
      const result = await runCloudProbe()
      setAppCheckResult('App Check token obtained on this browser.')
      setCloudResult('Verified ' + result.source + ' inference with Gemini Developer API. Model replied: ' + result.text)
    } catch (error) {
      setCloudResult('Cloud inference not verified: ' + (error instanceof Error ? error.message : 'Unknown error') + '. No case evidence was sent.')
    } finally {
      setProbeRunning(null)
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to investigation content</a>
      <header className="topbar">
        <div className="brand"><span className="brand-symbol">◇</span> PHANTOMGRAPH <span className="brand-suffix">AI</span></div>
        <div className="top-status"><span>CASE 01</span><span className="dot">•</span><span>Local data only</span><span className="demo-pill">{section === 'workspace' ? 'PRIVATE CASE' : 'FICTIONAL DEMO'}</span></div>
      </header>

      <div className={'layout' + (section === 'workspace' ? ' real-workspace-mode' : '')}>
        <nav className="sidebar" aria-label="Investigation sections">
          <p className="sidebar-title">WORKSPACE</p>
          {sections.map((item) => <button key={item.key} className={'nav-item ' + (section === item.key ? 'active' : '')} type="button" onClick={() => setSection(item.key)} aria-current={section === item.key ? 'page' : undefined}>{item.name}</button>)}
          <div className="sidebar-foot">
            <span className="green-dot" /> Sample data stays in this browser
            <p>{section === 'workspace' ? 'Your case is held only in page memory. Cloud review requires explicit approval.' : 'Sample investigation is scripted; AI is optional.'}</p>
          </div>
        </nav>

        <main className="main-panel" id="main" tabIndex={-1}>
          {section === 'workspace' && <InvestigationWorkspace />}
          {section === 'overview' && (
            <>
              <div className="section-heading"><p className="eyebrow">CASE 01 · FICTIONAL INTERNSHIP</p><h1>Case overview</h1><p>Compare fictional documents and trace concerns to evidence. Investigation stays scripted; optional AI diagnostics do not analyze case files.</p></div>
              <div className="metric-grid">
                <div className="metric"><span>Sample evidence</span><strong>03</strong><small>Fictional source items</small></div>
                <div className="metric"><span>Tracked findings</span><strong>04</strong><small>Not fraud judgments</small></div>
                <div className="metric"><span>Case files uploaded</span><strong>00</strong><small>None sent</small></div>
              </div>
              <article className="info-card"><h2>Why this case matters</h2><p>A job offer promises ₹35,000 per month, but a recruiter message asks for a ₹2,499 verification fee and names a differently spelled website. These details warrant independent checks. They do not prove wrongdoing.</p><button className="primary-action" onClick={() => setSection('investigation')}>Explore evidence graph <span aria-hidden="true">→</span></button></article>
              <article className="info-card">
                <h2>Hybrid inference readiness</h2>
                <p>Real Firebase AI Logic connectivity checks use fixed fictional text only. These diagnostics never analyze the investigation, upload case documents, or automatically fall back to a cloud model.</p>
                <p className="small-muted">Web configuration: {firebaseConfigured ? (appCheckResult.startsWith('App Check token obtained') ? 'Provided; App Check verified in this browser session' : 'Provided; App Check not yet verified in this session') : 'Not configured on Render'}</p>
                <button className="outline-action" type="button" disabled={!firebaseConfigured || checkingAppCheck || Boolean(probeRunning)} onClick={testAttestation}>{checkingAppCheck ? 'Verifying…' : 'Verify App Check token'}</button>
                {appCheckResult && <p className="status-message" role="status">{appCheckResult}</p>}
                <div className="probe-divider" />
                <h3>1. Test on-device AI</h3>
                <p className="small-muted">Chrome Desktop 139+ with Prompt API enabled is required. Firefox does not support Firebase's web on-device model. This test never calls cloud inference.</p>
                <button className="outline-action" type="button" disabled={!firebaseConfigured || !canUseOnDevice || Boolean(probeRunning) || checkingAppCheck} onClick={testDeviceInference}>{probeRunning === 'device' ? 'Testing local model…' : 'Test on-device inference'}</button>
                {deviceDownloadProgress > 0 && deviceDownloadProgress < 1 && <p className="small-muted">Local model download: {Math.round(deviceDownloadProgress * 100)}%</p>}
                {deviceResult && <p className="status-message" role="status">{deviceResult}</p>}
                <div className="probe-divider" />
                <h3>2. Test Firebase cloud AI</h3>
                <p className="small-muted">Uses Gemini Developer API model gemini-3.5-flash-lite. One fixed fictional prompt is sent only when you click the button. No investigation data is uploaded. Free-tier quota limits apply.</p>
                <label className="probe-consent"><input type="checkbox" checked={sparkConfirmed} onChange={(event) => setSparkConfirmed(event.target.checked)} /> I checked that this Firebase project is on the no-cost Spark plan and has no billing account linked.</label>
                <button className="outline-action" type="button" disabled={!firebaseConfigured || !sparkConfirmed || cloudProbeAttempted || Boolean(probeRunning) || checkingAppCheck} onClick={testCloudInference}>{probeRunning === 'cloud' ? 'Testing cloud model…' : cloudProbeAttempted ? 'Cloud probe attempted (refresh to retry)' : 'Send one fictional cloud test'}</button>
                {cloudResult && <p className="status-message" role="status">{cloudResult}</p>}
                <p className="small-muted">App Check token retrieval and AI inference are separate checks. A passed App Check test alone is not proof that cloud or local AI works.</p>
              </article>
            </>
          )}

          {section === 'evidence' && (
            <>
              <div className="section-heading"><p className="eyebrow">SOURCE LIBRARY</p><h1>Evidence (3)</h1><p>These are scripted, fictional excerpts. Real-file ingestion and OCR are future development milestones.</p></div>
              <div className="evidence-list">{evidence.map((item) => (
                <article className="evidence-card" key={item.id}>
                  <div className="evidence-icon" aria-hidden="true">▣</div><div><h2>{item.name}</h2><p className="small-muted">{item.format} · {item.anchor}</p><p>{item.note}</p></div>
                  <button className="outline-action" onClick={() => openEvidence(item.id)}>Read excerpt</button>
                </article>
              ))}</div>
            </>
          )}

          {section === 'findings' && (
            <>
              <div className="section-heading"><p className="eyebrow">EVIDENCE-LED ANALYSIS</p><h1>Findings (4)</h1><p>Review the supporting sources, uncertainty, and recommended verification steps.</p></div>
              <div className="finding-list">{findings.map((finding) => (
                <button type="button" className={'finding-row ' + (selectedFinding === finding.id ? 'selected' : '')} key={finding.id} onClick={() => selectFinding(finding.id)}>
                  <span><strong>{finding.title}</strong><small>{finding.description}</small></span><span className={'state-chip ' + statusClass(finding.status)}>{finding.status}</span>
                </button>
              ))}</div>
            </>
          )}

          {section === 'investigation' && (
            <>
              <div className="section-heading"><p className="eyebrow">CASE 01 · VISUAL INVESTIGATION</p><h1>Evidence relationship graph</h1><p>Connections are hypotheses until supported by source evidence. Select a node to inspect related findings.</p></div>
              <div className="graph-wrapper" aria-label="Interactive fictional evidence relationship graph">
                <div className="network">
                  <svg className="connections" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {edges.map(([from, to], index) => <line key={index} x1={nodes[from].x} y1={nodes[from].y} x2={nodes[to].x} y2={nodes[to].y}/>)}
                  </svg>
                  {nodes.map((node) => <button key={node.id} type="button" className={'graph-node ' + node.tone + (currentFinding.id === node.finding ? ' node-focus' : '')} style={{ left: `clamp(62px, ${node.x}%, calc(100% - 62px))`, top: node.y + '%' }} onClick={() => selectFinding(node.finding, node.id === 'email' ? 'email' : node.id === 'offer' ? 'offer' : undefined)} aria-label={node.label + ': inspect related evidence'}>{node.label}</button>)}
                </div>
                <div className="graph-legend"><span><i className="legend-circle sources" /> Source</span><span><i className="legend-circle claims" /> Claim</span><span><i className="legend-circle risks" /> Concern</span></div>
              </div>
              <p className="accessibility-note">Accessible alternative: <button className="inline-link" onClick={() => setSection('findings')}>browse all findings as a text list</button>.</p>
            </>
          )}

          {section === 'report' && (
            <>
              <div className="section-heading"><p className="eyebrow">SHARE RESPONSIBLY</p><h1>Investigation report</h1><p>Export a fictional, evidence-linked report with uncertainty and safe next steps.</p></div>
              <article className="info-card"><div className="report-header"><h2>CASE 01 · Sample internship inquiry</h2><span className="state-chip caution">Needs human verification</span></div><p>Three fictional items and four evidence-linked observations. This is not a professional fraud, legal, or identity verification service.</p><div className="report-preview"><strong>Report contents</strong><p>Evidence index · Individual findings · Source excerpts · Verification steps · Limitations</p></div><button className="primary-action" onClick={downloadReport}>Download sample text report <span aria-hidden="true">↓</span></button><p className="small-muted">Created entirely in your browser. No files are transmitted.</p></article>
            </>
          )}
        </main>

        {section !== 'workspace' && <aside className="inspector" aria-label="Finding details and source references">
          <div className="inspector-heading"><h2>Finding details</h2><span className={'state-chip ' + statusClass(currentFinding.status)}>{currentFinding.status}</span></div>
          <h3>{currentFinding.title}</h3>
          <p>{currentFinding.description}</p>
          <h4>EVIDENCE</h4>
          <div className="source-links">{currentFinding.evidenceIds.map((id) => {const item = evidence.find((source) => source.id === id);return item ? <button key={item.id} className="source-link" onClick={() => openEvidence(item.id)}>{item.name} · {item.anchor} <span aria-hidden="true">↗</span></button> : null})}</div>
          <h4>NEXT CHECK</h4><p>{currentFinding.nextStep}</p>
          <button className="primary-action inspector-action" onClick={() => openEvidence(currentFinding.evidenceIds.includes(selectedEvidence) ? selectedEvidence : currentFinding.evidenceIds[0])}>Open source snippet <span aria-hidden="true">↗</span></button>
          <button className="privacy-action" onClick={() => setPrivacyOpen((value) => !value)} aria-expanded={privacyOpen}>Privacy and cloud controls {privacyOpen ? '−' : '+'}</button>
          {privacyOpen && <div className="privacy-panel"><strong>Fictional investigation only</strong><p>Real-world evidence is not accepted. Optional Overview connectivity probes may use fixed fictional text, never this case's evidence. Investigation itself never calls cloud or local AI.</p><p>Future cloud flow: local extraction → redact → preview exact payload → explicit approval → request with verified inference source.</p></div>}
        </aside>}
      </div>

      {sourceOpen && <div className="modal-backdrop" onClick={() => setSourceOpen(false)}>
        <div role="dialog" aria-modal="true" aria-labelledby="source-title" className="source-dialog" ref={dialogRef} onClick={(event) => event.stopPropagation()}>
          <div className="dialog-top"><div><p className="eyebrow">FICTIONAL SAMPLE · SOURCE EXCERPT</p><h2 id="source-title">{currentEvidence.name}</h2></div><button className="close-dialog" aria-label="Close source snippet" onClick={() => setSourceOpen(false)}>×</button></div>
          <span className="source-anchor">{currentEvidence.anchor}</span><blockquote>{currentEvidence.excerpt}</blockquote><p className="small-muted">{currentEvidence.note}</p><p className="small-muted">Evidence is fictional. The app did not read or upload an original attachment.</p>
          <button className="primary-action" onClick={() => setSourceOpen(false)}>Back to investigation</button>
        </div>
      </div>}

      <footer className="footer">PHANTOMGRAPH AI · SOURCE FIRST <span>{section === 'workspace' ? 'Local extraction · source-linked findings · optional consented cloud analysis' : 'Fictional sample · opt-in AI diagnostics'}</span></footer>
    </div>
  )
}
