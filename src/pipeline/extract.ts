import type { EvidenceDocument, SourceSegment } from './core'

export const MAX_FILES = 8
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024
export const MAX_SEGMENTS = 240
export const MAX_TEXT_PER_DOC = 85_000

const allowed = ['.txt', '.md', '.csv', '.json', '.pdf', '.docx', '.png', '.jpg', '.jpeg']
export const acceptedFileTypes = allowed.join(',')

function getExtension(name: string): string {
  return name.slice(name.lastIndexOf('.')).toLowerCase()
}

export function validateFileSelection(files: Pick<File, 'name' | 'size'>[]): void {
  if (!files.length) throw new Error('Select at least one file.')
  if (files.length > MAX_FILES) throw new Error('Choose at most ' + MAX_FILES + ' documents.')
  if (files.some(file => !allowed.includes(getExtension(file.name)))) {
    throw new Error('Unsupported file type. Use TXT, MD, CSV, JSON, PDF, DOCX, PNG or JPEG.')
  }
  if (files.some(file => file.size === 0 || file.size > MAX_FILE_BYTES)) {
    throw new Error('Every file must be non-empty and no larger than 8 MiB.')
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
    throw new Error('Combined file size must not exceed 24 MiB.')
  }
}

function makeSegments(text: string, anchorPrefix: 'line' | 'paragraph' = 'line'): SourceSegment[] {
  const chunks = text.replace(/\r\n?/g, '\n').split('\n')
  const segments: SourceSegment[] = []
  let used = 0
  for (let i = 0; i < chunks.length && segments.length < MAX_SEGMENTS; i++) {
    const line = chunks[i].trim()
    if (!line) continue
    if (used + line.length > MAX_TEXT_PER_DOC) break
    segments.push({ id: 'a-' + segments.length, anchor: anchorPrefix + ' ' + (i + 1), text: line.slice(0, 3500) })
    used += line.length
  }
  return segments
}

function assertZipSizeSafe(data: ArrayBuffer): void {
  // Inspect the ZIP central directory before allowing a DOCX extractor to decompress.
  // A small compressed archive can expand to enormous content (ZIP bomb).
  const view = new DataView(data)
  let end = -1
  for (let offset = Math.max(0, data.byteLength - 65557); offset <= data.byteLength - 22; offset++) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break }
  }
  if (end < 0) throw new Error('Invalid DOCX ZIP structure.')
  const entries = view.getUint16(end + 10, true)
  let cursor = view.getUint32(end + 16, true)
  let totalExpanded = 0
  if (entries > 1500) throw new Error('Document contains too many archive entries.')
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > data.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('DOCX archive directory is damaged.')
    }
    const uncompressed = view.getUint32(cursor + 24, true)
    const compressed = view.getUint32(cursor + 20, true)
    if (uncompressed === 0xffffffff || compressed === 0xffffffff) throw new Error('ZIP64 DOCX is not supported.')
    if (view.getUint16(cursor + 8, true) & 1) throw new Error('Encrypted DOCX is not supported.')
    totalExpanded += uncompressed
    if (totalExpanded > 16 * 1024 * 1024) throw new Error('DOCX expands beyond the safe 16 MiB limit.')
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    cursor += 46 + nameLength + extraLength + commentLength
  }
}

async function readDOCX(file: File): Promise<{ segments: SourceSegment[]; warnings: string[] }> {
  const buffer = await file.arrayBuffer()
  const magic = new Uint8Array(buffer, 0, 4)
  if (magic[0] !== 0x50 || magic[1] !== 0x4b) throw new Error('This DOCX does not contain a valid ZIP header.')
  assertZipSizeSafe(buffer)
  const mammoth = await import('mammoth/mammoth.browser.js')
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  const segments = makeSegments(result.value, 'paragraph')
  const warnings = result.messages.map(message => message.message).slice(0, 3)
  if (!segments.length) warnings.push('No readable paragraphs were found in this Word document.')
  return { segments, warnings }
}

async function getOCRWorker() {
  // Tesseract downloads its public English model on first use. Images and canvas
  // pixels remain in this browser and are never posted to the model host.
  const { createWorker } = await import('tesseract.js')
  return createWorker('eng')
}

async function readImage(file: File): Promise<{ segments: SourceSegment[]; warnings: string[] }> {
  const bitmap = await createImageBitmap(file)
  let canvas: HTMLCanvasElement
  try {
    const scale = Math.min(1, 2500 / Math.max(bitmap.width, bitmap.height))
    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('A 2D canvas is unavailable for local OCR.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  } finally {
    bitmap.close()
  }
  const worker = await getOCRWorker()
  try {
    const result = await worker.recognize(canvas)
    const segments = makeSegments(result.data.text)
    return {
      segments,
      warnings: ['Image text was estimated by browser-side OCR and may contain mistakes.' +
        ' Inspect the original image before treating a quotation as verified.'],
    }
  } finally {
    await worker.terminate()
    canvas.width = 0
    canvas.height = 0
  }
}

async function readPDF(file: File): Promise<{ segments: SourceSegment[]; warnings: string[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (new TextDecoder().decode(bytes.slice(0, 8)).indexOf('%PDF-') < 0) throw new Error('Invalid PDF header.')
  const pdfjs = await import('pdfjs-dist')
  const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default
  const loading = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: true,
  })
  const warnings: string[] = []
  const segments: SourceSegment[] = []
  const pdf = await loading.promise
  try {
    if (pdf.numPages > 25) warnings.push('Only the first 25 PDF pages were processed.')
    let ocrWorker: Awaited<ReturnType<typeof getOCRWorker>> | null = null
    try {
      for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 25); pageNumber++) {
        const page = await pdf.getPage(pageNumber)
        const text = await page.getTextContent()
        const value = text.items.map(item => 'str' in item ? item.str : '').join(' ').trim()
        if (value.length > 15) {
          segments.push({ id: 'a-' + segments.length, anchor: 'page ' + pageNumber, text: value.slice(0, 3600) })
        } else if (pageNumber <= 4) {
          ocrWorker = ocrWorker || await getOCRWorker()
          const viewport = page.getViewport({ scale: 1.5 })
          const ratio = Math.min(1, 2200 / Math.max(viewport.width, viewport.height))
          const view = page.getViewport({ scale: 1.5 * ratio })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(view.width)
          canvas.height = Math.ceil(view.height)
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (!ctx) throw new Error('PDF canvas cannot be created.')
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          try {
            await page.render({ canvasContext: ctx, canvas, viewport: view }).promise
            const result = await ocrWorker.recognize(canvas)
            if (result.data.text.trim()) segments.push({ id: 'a-' + segments.length, anchor: 'page ' + pageNumber + ' (OCR)', text: result.data.text.trim().slice(0, 3600) })
          } finally {
            canvas.width = 0
            canvas.height = 0
          }
          warnings.push('Page ' + pageNumber + ' required OCR; check its transcription against the source.')
        } else {
          warnings.push('Page ' + pageNumber + ' had no extractable text. Scanned-page OCR is limited to the first four pages.')
        }
        page.cleanup()
        if (segments.reduce((sum, segment) => sum + segment.text.length, 0) > MAX_TEXT_PER_DOC) {
          warnings.push('PDF extraction stopped at the per-document text limit.')
          break
        }
      }
    } finally {
      if (ocrWorker) await ocrWorker.terminate()
    }
  } finally {
    await pdf.destroy()
  }
  return { segments, warnings }
}

export async function extractLocalFile(file: File, id: string): Promise<EvidenceDocument> {
  const ext = getExtension(file.name)
  validateFileSelection([file])
  let result: { segments: SourceSegment[]; warnings: string[] }
  if (ext === '.pdf') result = await readPDF(file)
  else if (ext === '.docx') result = await readDOCX(file)
  else if (['.png', '.jpg', '.jpeg'].includes(ext)) result = await readImage(file)
  else {
    const raw = await file.text()
    result = { segments: makeSegments(raw), warnings: [] }
  }
  if (!result.segments.length) throw new Error('No readable text was extracted from ' + file.name + '. Check document quality or format.')
  return {
    id,
    name: file.name.slice(0, 150),
    format: ext.slice(1).toUpperCase(),
    size: file.size,
    segments: result.segments,
    warnings: result.warnings,
  }
}

export async function extractLocalFiles(
  files: File[],
  onProgress: (message: string) => void = () => {},
): Promise<EvidenceDocument[]> {
  validateFileSelection(files)
  const documents: EvidenceDocument[] = []
  for (let i = 0; i < files.length; i++) {
    onProgress('Reading ' + (i + 1) + ' / ' + files.length + ': ' + files[i].name)
    // Reject rather than silently skipping a document, which would produce an incomplete analysis.
    documents.push(await extractLocalFile(files[i], 'source-' + i))
  }
  onProgress('Extracted ' + documents.length + ' documents locally.')
  return documents
}
