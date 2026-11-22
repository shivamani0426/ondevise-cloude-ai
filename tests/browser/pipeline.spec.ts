import { test, expect } from '@playwright/test'

const offer = 'Northstar Labs offers stipend ₹35,000 per month. Official website northstar.example.\nNo registration or verification fee is required.'
const email = 'Recruiter: Please pay ₹2,499 registration verification fee today at northstarr.example.\nContact hr@example.com or +919876543210.'
const txt = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') })

async function openWorkspace(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Analyze Documents' }).click()
  await expect(page.getByRole('heading', { name: 'Document-to-evidence pipeline' })).toBeVisible()
}

function createPDF(text: string): Buffer {
  const clean = text.replace(/[^\x20-\x7e]/g, ' ').replace(/[\\()]/g, ' ')
  const contents = 'BT /F1 12 Tf 72 720 Td (' + clean + ') Tj ET'
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + contents.length + ' >>\nstream\n' + contents + '\nendstream',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += (i + 1) + ' 0 obj\n' + objs[i] + '\nendobj\n'
  }
  const start = Buffer.byteLength(pdf, 'latin1')
  pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) pdf += String(offset).padStart(10, '0') + ' 00000 n \n'
  pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF'
  return Buffer.from(pdf, 'latin1')
}

test('real text documents produce independently selectable citations, graph and export', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('#evidence-upload').setInputFiles([txt('offer.txt', offer), txt('message.txt', email)])
  await page.getByRole('button', { name: 'Extract selected files locally' }).click()
  await expect(page.getByText('Local extraction complete.', { exact: false })).toBeVisible()
  await expect(page.getByText('offer.txt', { exact: true })).toBeVisible()
  await expect(page.getByText('message.txt', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Build evidence graph and findings' }).click()
  await expect(page.getByRole('heading', { name: 'Evidence graph and findings' })).toBeVisible()
  await expect(page.getByText('Conflicting fee statements across sources', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Multiple domains appear in evidence', { exact: true }).first()).toBeVisible()
  const refs = page.locator('.case-citations .inline-link')
  await expect(refs.first()).toBeVisible()
  await refs.first().click()
  await expect(page.locator('.case-excerpt blockquote')).toContainText(/fee|payment|registration/)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download redacted investigation report' }).click()
  expect((await download).suggestedFilename()).toBe('phantomgraph-redacted-report.txt')
  await page.getByRole('button', { name: 'Clear case from memory' }).last().click()
  await expect(page.getByRole('heading', { name: 'Evidence graph and findings' })).toHaveCount(0)
  await expect(page.getByText('Case cleared from page memory.', { exact: false })).toBeVisible()
})

test('cloud payload starts redacted, must be reviewed and never sends silently', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => {
    if (/generativelanguage|firebasevertexai|firebaseappcheck|recaptcha/i.test(request.url())) requests.push(request.url())
  })
  await openWorkspace(page)
  await page.locator('#evidence-upload').setInputFiles(txt('sensitive.txt', email))
  await page.getByRole('button', { name: 'Extract selected files locally' }).click()
  await page.getByRole('button', { name: 'Build evidence graph and findings' }).click()
  await page.getByRole('button', { name: 'Prepare locally redacted cloud preview' }).click()
  const payload = page.locator('#approved-cloud-payload')
  await expect(payload).toBeVisible()
  await expect(payload).not.toHaveValue(/hr@example.com|\+919876543210/)
  await expect(payload).toHaveValue(/\[EMAIL_REDACTED\]/)
  await expect(page.getByRole('button', { name: 'Send this exact approved payload once' })).toBeDisabled()
  await page.getByRole('checkbox', { name: /I verified Firebase Spark/ }).check()
  await page.getByRole('checkbox', { name: /I reviewed every character/ }).check()
  await payload.fill((await payload.inputValue()) + '\nMANUAL_EDIT')
  await expect(page.getByRole('checkbox', { name: /I reviewed every character/ })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Send this exact approved payload once' })).toBeDisabled()
  expect(requests).toEqual([])
})

test('invalid files and malformed PDF are rejected without constructing findings', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('#evidence-upload').setInputFiles(txt('malicious.exe', 'payload'))
  await expect(page.getByRole('alert')).toContainText('Unsupported file type')
  await page.locator('#evidence-upload').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Not a PDF') })
  await page.getByRole('button', { name: 'Extract selected files locally' }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid PDF header')
  await expect(page.getByRole('heading', { name: 'Evidence graph and findings' })).toHaveCount(0)
})

test('text-based PDF ingestion extracts page text with an anchored source', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('#evidence-upload').setInputFiles({
    name: 'offer.pdf', mimeType: 'application/pdf',
    buffer: createPDF('This is an internship confirmation with monthly stipend and official website northstar.example.'),
  })
  await page.getByRole('button', { name: 'Extract selected files locally' }).click()
  await expect(page.getByText('Local extraction complete.', { exact: false })).toBeVisible({ timeout: 25000 })
  await page.getByRole('button', { name: 'Build evidence graph and findings' }).click()
  await expect(page.getByRole('heading', { name: 'Evidence graph and findings' })).toBeVisible()
  await expect(page.locator('.case-excerpt blockquote')).toContainText('internship confirmation')
  await expect(page.locator('.case-excerpt')).toContainText('page 1')
})

test('mobile document workflow does not overflow horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openWorkspace(page)
  await page.locator('#evidence-upload').setInputFiles(txt('offer.txt', offer))
  await page.getByRole('button', { name: 'Extract selected files locally' }).click()
  await page.getByRole('button', { name: 'Build evidence graph and findings' }).click()
  await expect(page.locator('.case-graph-map')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(2)
})


test('manual correction invalidates findings and updates quoted source before regeneration', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('#evidence-upload').setInputFiles(txt('offer.txt', 'No registration fee is required.'))
  await page.getByRole('button', { name: 'Extract selected files locally' }).click()
  await expect(page.locator('.case-excerpt blockquote')).toContainText('No registration fee')
  await page.getByRole('button', { name: 'Correct this excerpt' }).click()
  const editing = page.locator('#manual-excerpt-correction')
  await editing.fill('Updated payment terms: a verification fee is required before joining.')
  await page.getByRole('button', { name: 'Save correction and invalidate old analysis' }).click()
  await expect(page.getByText('Correction saved only in browser memory.', { exact: false })).toBeVisible()
  await expect(page.locator('.case-excerpt blockquote')).toContainText('Updated payment terms')
  await page.getByRole('button', { name: 'Build evidence graph and findings' }).click()
  await expect(page.getByText('Payment or verification charge mentioned', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Evidence graph and findings' })).toBeVisible()
})


function crc32(bytes: Buffer): number {
  let result = 0xffffffff
  for (const byte of bytes) {
    result ^= byte
    for (let j = 0; j < 8; j++) result = result & 1 ? (result >>> 1) ^ 0xedb88320 : result >>> 1
  }
  return (result ^ 0xffffffff) >>> 0
}

function makeDOCX(text: string): Buffer {
  const xml = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const entries = [
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + xml + '</w:t></w:r></w:p></w:body></w:document>'],
  ]
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const body = Buffer.from(value, 'utf8')
    const crc = crc32(body)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + body.length
  }
  const central = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, end])
}

test('real DOCX text is extracted in-browser with paragraph anchors', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('#evidence-upload').setInputFiles({
    name: 'terms.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: makeDOCX('This internship requires a verification fee before joining.'),
  })
  await page.getByRole('button', { name: 'Extract selected files locally' }).click()
  await expect(page.getByText('Local extraction complete.', { exact: false })).toBeVisible({ timeout: 25000 })
  await expect(page.locator('.case-excerpt blockquote')).toContainText('verification fee before joining')
  await expect(page.locator('.case-excerpt')).toContainText('paragraph 1')
})
