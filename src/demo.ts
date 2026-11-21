export type EvidenceItem = {
  id: string
  name: string
  format: string
  anchor: string
  excerpt: string
  note: string
}

export type FindingStatus = 'Possible concern' | 'Insufficient evidence' | 'Corroborated fact'
export type Finding = {
  id: string
  title: string
  status: FindingStatus
  description: string
  evidenceIds: string[]
  nextStep: string
}

export const evidence: EvidenceItem[] = [
  {
    id: 'offer',
    name: 'Offer.pdf',
    format: 'PDF · fictional sample',
    anchor: 'page 2',
    excerpt: 'Northstar Labs offers a remote internship with compensation of ₹35,000 per month. Official website: northstar.example. The letter does not specify a registration or verification fee.',
    note: 'Sample text is provided by the demo; PDF parsing is not implemented yet.',
  },
  {
    id: 'email',
    name: 'Recruiter_email.png',
    format: 'PNG · fictional sample',
    anchor: 'line 14',
    excerpt: 'Before joining, pay a ₹2,499 registration verification fee. For instructions visit northstarr.example. Kindly complete payment today.',
    note: 'Sample transcription is provided by the demo; image OCR is not implemented yet.',
  },
  {
    id: 'invoice',
    name: 'Invoice.txt',
    format: 'Text · fictional sample',
    anchor: 'line 3',
    excerpt: 'Invoice reference: internship verification. Registration charge: ₹2,499. Payment is requested before the candidate receives onboarding instructions.',
    note: 'Synthetic evidence created for a repeatable hackathon walkthrough.',
  },
]

export const findings: Finding[] = [
  {
    id: 'fee',
    title: 'Unexpected fee request',
    status: 'Possible concern',
    description: 'The recruiter message requests a ₹2,499 fee that is not specified in the original offer. An omission is a concern, not proof of a contradiction or fraud.',
    evidenceIds: ['email', 'offer', 'invoice'],
    nextStep: 'Contact the organization through an independently obtained official channel. Do not pay based solely on these messages.',
  },
  {
    id: 'domain',
    title: 'Company domain differs',
    status: 'Possible concern',
    description: 'The offer names northstar.example, while the recruiter message directs the applicant to northstarr.example. The difference needs independent verification.',
    evidenceIds: ['offer', 'email'],
    nextStep: 'Obtain the genuine company website independently and verify the recruiter identity.',
  },
  {
    id: 'payment',
    title: 'Payment request repeated',
    status: 'Corroborated fact',
    description: 'Both the recruiter message and the invoice mention a ₹2,499 charge. Their agreement does not establish legitimacy.',
    evidenceIds: ['email', 'invoice'],
    nextStep: 'Request written justification through a verified organization contact.',
  },
  {
    id: 'salary',
    title: 'Salary not independently confirmed',
    status: 'Insufficient evidence',
    description: 'The offer mentions ₹35,000 monthly compensation. The other demo items do not independently verify the salary or employment relationship.',
    evidenceIds: ['offer'],
    nextStep: 'Confirm compensation and terms with a verified organization representative.',
  },
]

export const nodes = [
  { id: 'offer', label: 'JOB OFFER', x: 27, y: 34, tone: 'blue', finding: 'fee' },
  { id: 'email', label: 'RECRUITER EMAIL', x: 63, y: 20, tone: 'sky', finding: 'domain' },
  { id: 'payment', label: 'PAYMENT REQUEST', x: 65, y: 68, tone: 'rose', finding: 'fee' },
  { id: 'salary', label: 'SALARY CLAIM', x: 37, y: 86, tone: 'mint', finding: 'salary' },
  { id: 'mismatch', label: 'MISMATCH', x: 88, y: 46, tone: 'amber', finding: 'domain' },
] as const

export const edges: Array<[number, number]> = [
  [0, 1], [0, 3], [0, 4], [1, 2], [1, 4], [2, 3], [2, 4],
]

export function reportText(): string {
  return [
    'PHANTOMGRAPH AI — FICTIONAL INVESTIGATION REPORT',
    'CASE 01 • LOCAL-ONLY DEMONSTRATION',
    'This is not a legal, criminal, or definitive fraud determination.',
    '',
    'EVIDENCE',
    ...evidence.map((item) => item.name + ' (' + item.anchor + '): ' + item.excerpt),
    '',
    'FINDINGS',
    ...findings.flatMap((finding) => [
      finding.title + ' — ' + finding.status,
      finding.description,
      'Sources: ' + finding.evidenceIds.map((id) => evidence.find((item) => item.id === id)?.name || id).join(', '),
      'Suggested check: ' + finding.nextStep,
      '',
    ]),
    'No real user documents were processed or uploaded.',
    'No cloud or on-device AI inference was performed for this sample report.',
  ].join('\n')
}
