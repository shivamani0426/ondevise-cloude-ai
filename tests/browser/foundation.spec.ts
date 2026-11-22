import { test, expect } from '@playwright/test'

test('graph opens the correct source, and modal supports focus and Escape', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Evidence relationship graph' })).toBeVisible()
  await page.getByRole('button', { name: 'RECRUITER EMAIL: inspect related evidence' }).click()
  await expect(page.getByRole('heading', { name: 'Company domain differs' })).toBeVisible()
  const trigger = page.getByRole('button', { name: /Open source snippet/ })
  await trigger.click()
  await expect(page.getByRole('dialog')).toContainText('Recruiter_email.png')
  await expect(page.getByRole('dialog')).toContainText('northstarr.example')
  const close = page.getByRole('button', { name: 'Close source snippet' })
  await expect(close).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('evidence, findings, source references and report download', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Evidence (3)' }).click()
  await expect(page.getByRole('heading', { name: 'Evidence (3)' })).toBeVisible()
  await page.getByRole('button', { name: 'Read excerpt' }).first().click()
  await expect(page.getByRole('dialog')).toContainText('Offer.pdf')
  await page.getByRole('button', { name: 'Close source snippet' }).click()
  await page.getByRole('button', { name: 'Findings (4)' }).click()
  await expect(page.getByRole('heading', { name: 'Findings (4)' })).toBeVisible()
  await page.getByRole('button', { name: /Company domain differs/ }).click()
  await expect(page.getByRole('heading', { name: 'Company domain differs' })).toBeVisible()
  await page.getByRole('button', { name: 'Report / Export' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Download sample text report/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('phantomgraph-fictional-case-01.txt')
})

test('mobile screen does not scroll horizontally or clip the mismatch node', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const mismatch = page.getByRole('button', { name: 'MISMATCH: inspect related evidence' })
  await expect(mismatch).toBeVisible()
  const bounds = await mismatch.boundingBox()
  expect(bounds).toBeTruthy()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('no evidence or AI requests are sent when exploring the fictional sample', async ({ page }) => {
  const outbound: string[] = []
  page.on('request', request => {
    if (/firebase|googleapis|generativelanguage|recaptcha|cloudfunctions/i.test(request.url())) outbound.push(request.url())
  })
  await page.goto('/')
  await page.getByRole('button', { name: /RECRUITER EMAIL/ }).click()
  await page.getByRole('button', { name: /Open source snippet/ }).click()
  await page.getByRole('button', { name: 'Close source snippet' }).click()
  await page.getByRole('button', { name: 'Overview' }).click()
  await expect(page.getByText('Not configured on Render')).toBeVisible()
  expect(outbound).toEqual([])
})


test('Overview keeps AI diagnostics opt-in, not silently invoked during browsing', async ({ page }) => {
  const aiRequests: string[] = []
  page.on('request', request => {
    if (/generativelanguage|firebaseappcheck|firebasevertexai/i.test(request.url())) aiRequests.push(request.url())
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Overview' }).click()
  await expect(page.getByRole('heading', { name: 'Hybrid inference readiness' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Verify App Check token' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Test on-device inference' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Send one fictional cloud test' })).toBeDisabled()
  const consent = page.getByRole('checkbox', { name: /I checked that this Firebase project/ })
  await consent.check()
  // Missing Firebase config in this CI build must still block every cloud request.
  await expect(page.getByRole('button', { name: 'Send one fictional cloud test' })).toBeDisabled()
  await page.getByRole('button', { name: 'Investigation' }).click()
  await expect(page.getByRole('heading', { name: 'Evidence relationship graph' })).toBeVisible()
  expect(aiRequests).toEqual([])
})
