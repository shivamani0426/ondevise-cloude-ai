import { test, expect } from '@playwright/test'

const txt = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) })
async function openSimple(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Analyze Documents' }).click()
  await expect(page.getByRole('heading', { name: 'Understand your documents' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show advanced tools' })).toBeVisible()
}

test('simple first-run flow reviews fictional support ticket locally and preserves source trace', async ({ page }) => {
  const outgoing: string[] = []
  page.on('request', request => {
    if (/generativelanguage|firebasevertexai|attacker\.example/i.test(request.url())) outgoing.push(request.url())
  })
  await openSimple(page)
  await expect(page.locator('.case-graph-map')).toHaveCount(0)
  await page.getByRole('button', { name: 'Try a sample case' }).click()
  await expect(page.getByRole('heading', { name: "2. Here's what we found" })).toBeVisible()
  await expect(page.locator('.case-quick-stats')).toContainText('2')
  await expect(page.locator('.case-quick-finding')).toHaveCount(1)
  await expect(page.locator('.case-quick-finding')).toContainText('context-dependent recorded change')
  await expect(page.locator('.case-quick-lead')).toContainText('does not mean anything fraudulent')
  await page.locator('.case-quick-citations summary').click()
  await page.locator('.case-quick-links button').first().click()
  await expect(page.locator('.case-quick-excerpt')).toBeVisible()
  await expect(page.locator('.case-quick-excerpt')).toContainText('CASE-2027-9999')
  await page.locator('.case-quick-values button').first().click()
  await expect(page.locator('.case-quick-excerpt')).toContainText('status: open')
  await page.getByText('Explore evidence connections', { exact: true }).click()
  await expect(page.locator('.case-graph-map')).toBeVisible()
  await page.locator('.case-graph-node').first().click()
  await expect(page.locator('.case-quick-excerpt-graph')).toBeVisible()
  await page.getByRole('button', { name: 'Show advanced tools' }).click()
  await expect(page.getByRole('heading', { name: 'Document-to-evidence pipeline' })).toBeVisible()
  await expect(page.locator('.case-graph-map')).toBeVisible()
  await page.getByRole('button', { name: 'Use simple view' }).click()
  await expect(page.locator('.case-quick-finding')).toHaveCount(1)
  expect(outgoing).toEqual([])
})

test('simple upload handles invoice difference without exposing cloud controls', async ({ page }) => {
  await openSimple(page)
  await page.locator('#evidence-upload').setInputFiles([
    txt('invoice-a.txt', 'Invoice ID: INV-2027-0042\namount_usd: 350\nstatus: issued'),
    txt('invoice-b.txt', 'Invoice ID: INV-2027-0042\namount_usd: 450\nstatus: issued'),
  ])
  await page.getByRole('button', { name: 'Analyze these documents' }).click()
  await expect(page.locator('.case-quick-finding')).toContainText('Same reference, different recorded field values')
  await expect(page.locator('.case-quick-values')).toContainText('350')
  await expect(page.locator('.case-quick-values')).toContainText('450')
  await expect(page.getByRole('button', { name: 'Send this exact approved payload once' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Review and save as PDF' }).click()
  await expect(page.locator('.case-print-document')).toContainText('INVESTIGATION SUMMARY')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download text report' }).click()
  expect((await download).suggestedFilename()).toBe('phantomgraph-redacted-report.txt')
})

test('simple review is mobile-friendly and clearing case removes the result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openSimple(page)
  await page.getByRole('button', { name: 'Try a sample case' }).click()
  await expect(page.locator('.case-quick-results')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Clear case from memory' }).click()
  await expect(page.locator('.case-quick-results')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Try a sample case' })).toBeVisible()
})

test('matching and uncertain outcomes are distinct and local AI is reachable in simple mode',async ({page})=>{
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'Understand your documents'})).toBeVisible()
  await page.locator('#evidence-upload').setInputFiles([
    txt('a.txt','Application ID APP-2030-210 has an issue date of 2030-01-02.'),
    txt('b.txt','Application ID: APP-2030-210\ndate_of_issue: 2030-01-02'),
  ])
  await page.getByRole('button',{name:'Analyze these documents'}).click()
  await expect(page.locator('.case-outcome')).toHaveText('Matching details found')
  await expect(page.locator('.case-quick-values')).toContainText('2030-01-02')
  await expect(page.getByRole('button',{name:'Review case with on-device AI'})).toBeVisible()
  await page.getByRole('button',{name:'Clear case from memory'}).click()
  await page.locator('#evidence-upload').setInputFiles([
    txt('a.txt','Order ID: ORD-2030-1234\namount: INR 1000'),
    txt('b.txt','Order ID ending in 1234\namount: INR 1500'),
  ])
  await page.getByRole('button',{name:'Analyze these documents'}).click()
  await expect(page.locator('.case-outcome')).toHaveText('More information needed')
  await expect(page.locator('.case-quick-values')).toHaveCount(0)
})
