import { test, expect } from '@playwright/test'

const txt=(name:string,text:string)=>({name,mimeType:'text/plain',buffer:Buffer.from(text,'utf8')})
async function openWorkspace(page:import('@playwright/test').Page){
  await page.goto('/')
  await page.getByRole('button',{name:'Analyze Documents'}).click()
  await page.getByRole('button',{name:'Show advanced tools'}).click()
  await expect(page.getByRole('heading',{name:'Document-to-evidence pipeline'})).toBeVisible()
}
async function invoiceCase(page:import('@playwright/test').Page){
  await openWorkspace(page)
  await page.locator('#evidence-upload').setInputFiles([
    txt('private-terms.txt','Invoice ID: INV-2027-0042\namount_usd: 350\ncustomer_email: alice@example.com'),
    {name:'private-ledger.csv',mimeType:'text/csv',buffer:Buffer.from('invoice_id,amount_usd,status\nINV-2027-0042,450,issued')},
  ])
  await page.getByRole('button',{name:'Extract selected files locally'}).click()
  await expect(page.getByText('Local extraction complete.',{exact:false})).toBeVisible()
  await page.getByRole('button',{name:'Build evidence graph and findings'}).click()
}
test('pipelines 10-14 show evidence quality, graph filters, local decisions and printable report',async({page})=>{
  const outgoing:string[]=[]
  page.on('request',request=>{
    if(/generativelanguage|firebasevertexai|attacker\.example/i.test(request.url()))outgoing.push(request.url())
  })
  await invoiceCase(page)
  await expect(page.getByRole('heading',{name:'Pipeline 10 · Evidence quality and confidence'})).toBeVisible()
  await expect(page.getByText('2 of 2 sources have an excerpt cited',{exact:false})).toBeVisible()
  await page.locator('#graph-view-scope').selectOption('rules')
  await expect(page.locator('.case-graph-node.finding')).toHaveCount(1)
  await page.locator('#graph-source-filter').selectOption('source-0')
  await expect(page.locator('.case-graph-node.source')).toHaveCount(1)
  await page.locator('#graph-source-filter').selectOption('')
  await expect(page.locator('.case-graph-node.source')).toHaveCount(2)
  await page.locator('#review-decision').selectOption('explained')
  await page.locator('#review-reason').fill('Billing adjustment may explain the difference; originals need review.')
  await page.getByRole('button',{name:'Record investigator decision locally'}).click()
  await expect(page.locator('.case-review-history')).toContainText('explained')
  await expect(page.locator('.case-review-history')).toContainText('Billing adjustment')
  await page.getByRole('button',{name:'Prepare privacy-reviewed PDF preview'}).click()
  await expect(page.getByRole('heading',{name:'Pipeline 14 · Print / Save as PDF'})).toBeVisible()
  await expect(page.locator('.case-print-document')).toContainText('INVESTIGATION SUMMARY')
  await expect(page.locator('.case-print-document')).not.toContainText('alice@example.com')
  const pending=page.waitForEvent('download')
  await page.getByRole('button',{name:'Download structured JSON case report'}).click()
  expect((await pending).suggestedFilename()).toBe('phantomgraph-structured-investigation.json')
  expect(outgoing).toEqual([])
})
test('pipeline 12 requires new explicit privacy review after each edited cloud payload',async({page})=>{
  await invoiceCase(page)
  await expect(page.getByRole('heading',{name:'Pipeline 12 · Privacy readiness'})).toBeVisible()
  await expect(page.locator('.case-privacy-audit')).toContainText('EMAIL')
  await page.getByRole('button',{name:'Prepare locally redacted cloud preview'}).click()
  const send=page.getByRole('button',{name:'Send this exact approved payload once'})
  await expect(send).toBeDisabled()
  const privacy=page.getByLabel('I independently inspected the exact payload for names, addresses, secret values, and private context that automated masking may miss.')
  await privacy.check()
  const payload=page.locator('#approved-cloud-payload')
  await payload.fill((await payload.inputValue())+' ')
  await expect(privacy).not.toBeChecked()
  await expect(send).toBeDisabled()
})
