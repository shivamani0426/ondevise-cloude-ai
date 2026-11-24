# PhantomGraph AI — Simple review quick start

The default **Analyze Documents** workspace now begins in **Simple review**. It runs local extraction and rule-based comparison in one step, presents a short review, and offers redacted report downloads.

## One-click test (fictional support ticket)
1. Open PhantomGraph AI and choose **Analyze Documents**.
2. Click **Try a sample case**. Nothing is uploaded.
3. Read **Here's what we found**. The sample has the same case ID, `CASE-2027-9999`, with `status: open` in the first document and `status: closed` in the second.
4. A context-dependent status change should be presented as something to **verify**, not as proven fraud.
5. Expand **See the source lines** and click a citation to read extracted text.
6. Click **Review and save as PDF** to inspect locally redacted text before using the browser's Print dialog.
7. Click **Show advanced tools** to inspect source anchors, graph filters, evidence quality, manual reconciliation, and the opt-in AI panel.

**Important:** Matching case IDs and differing status strings do not prove an invalid record, a contradiction at the same time, or wrongdoing. An 'open' case can legitimately become 'closed' later. Check original timestamps, approvals, and amendments.

## Testing your own files
- Choose two related files (TXT, MD, CSV, PDF, DOCX or supported image).
- Click **Analyze these documents**. No model inference or cloud upload occurs.
- Review every source citation and compare with the original document.
- Use **Show advanced tools** when you need manual OCR corrections or additional forensic details.

The old advanced workflow is preserved and still has independent extraction, source correction, graph, reconciliation and privacy consent controls. All current case data remains in page memory.
