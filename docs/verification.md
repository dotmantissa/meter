# Verification record

Checked on 15 October 2026 against GenLayer Studio, chain 61999. The current addresses and code hashes are in [the deployment manifest](../deployments/studio.json). [Public receipts](../deployments/review-verification.json) record each case. The earlier record remains available as [history](verification-2026-10-14.md).

All 53 direct contract tests and 36 web tests passed. All 12 integration cases passed in 53.91 seconds: eleven Studio readbacks after fresh live submissions, plus an actual concurrent PostgreSQL test on Neon. All three production contracts and the isolated escrow driver pass GenVM lint. The audit has one documented warning for `io`, used solely for an in memory PDF buffer. Frontend lint, TypeScript, native Next production builds and Sites Worker builds passed.

## Fresh utility adjudication

The proof runner submitted six new audits with real document fetching, independent model extraction and the real GenVM sandbox. PSE reproduced $92.45 at 600 kWh and $108.55 at 700 kWh. Avista reproduced $92.58 at 800 kWh and $177.47 at 1,500 kWh. Pacific Power reproduced $82.86 for single family service and $81.11 for multifamily service at 700 kWh. The latter deliberately billed $20 extra and returned OVERCHARGE.

These cases use separate test tariff IDs and synthetic anonymous facts. They never enter the app's saved review index or supported utility aggregates. Every source PDF is real. Every page is extracted, subject to explicit rejection limits. The tests do not replace the PDF parser, model calls, validator agreement or sandbox.

Fresh PSE testing exposed AES encryption in its public utility PDF. The corrected bundle includes pyaes 1.6.1 alongside pypdf 6.10.2. Known AES vectors, strict padding checks and actual encrypted PDFs pass through the packaged reader. Rebuilding that package produces exactly the deployed SHA256. A separate parser regression places the authoritative text in the middle of a thirteen page PDF. Oversized evidence is rejected rather than sampled.

The direct audit fixture still uses the documented sandbox adapter required by genlayer test 0.29.2. The fresh Studio tests independently exercise the real sandbox. That boundary is deliberate and is not hidden by the unit test count.

## Settlement and historical evidence

An immediate monthly confirmation was rejected. A bonded confirmation retained the same material hash while advancing the revision. The open production escrow remained eligible. Attesting recovery of one cent from a $20 dispute released 500,000,000,000 wei as the fee and refunded 999,500,000,000,000 wei. Both native payout transactions finalized.

A separate deployed revision driver tested controlled state changes against the unchanged production escrow code. Automatic correction synchronization, manual synchronization and cancellation after MATCH each restored the depositor's exact prior balance. A repeat synchronization was harmless. This driver is an isolated test harness. It cannot update an application verdict and is not evidence of independent tariff extraction. The actual audit callback is covered separately in direct tests.

A legacy Avista audit was imported by its original owner. All three original document hashes matched the preserved archive. The new history retained the latest legacy snapshot and then a fresh MIGRATION revision, reproducing $92.58. The record identifies the original contract and revision. It does not pretend that the older contract stored a complete history.

The live archive endpoint returned PSE's three page utility PDF and its complete 133 page filed document. Their bytes matched the committed hashes exactly. Historical appeals use these preserved bytes even if a later live source changes. A hash alone cannot recover a document that disappeared before it was archived.

## Application and worker checks

The PostgreSQL state tests cover independent receipts, concurrent action reservations, auxiliary failure recovery, cancellation with no visible verdict, later direct contract revisions, migration races and delayed responses from an earlier contract. Source refresh tests cover failed, canceled and undetermined transactions, uncertain broadcasts and late receipt reconciliation.

The actual Neon concurrency test reserves the last slot across twelve different users exactly once. Twelve requests for the same user also consume one slot. It uses the exact production function in an isolated schema and drops that schema afterwards. It spends no sponsorship funds.

Both hosted apps passed desktop and mobile browser checks for the sticky header, keyboard and touch back to top, themes, navigation, email modal and local PDF parsing. No page errors, horizontal overflow or outgoing request containing the test PDF's private identity markers were found. An actual customer email OTP session was not exercised.

Anonymous review and worker requests returned 401. The Vercel host rejected a forged Sites identity header. The Sites worker completed an authorized POST and its protected GET returned the same saved run. There were no customer reviews due, and no customer bills were fabricated. The existing hourly Africa/Lagos task remains enabled; consent and the contract's 30 day gate determine actual rechecks.

The primary app is [Meter on Vercel](https://meter-audit.vercel.app). The [Sites app](https://meter-bill-review.candidtuna3.chatgpt.site) hosts the same application and recurring worker against the shared database and stable signing seed. Its version and source commit are recorded with the receipts. [Vercel deployment details](../deployments/vercel.json) preserve the verified release history.

Source, the complete Git history, the native browser bundle and the final Sites archive passed credential scans. Runtime secrets remain in ignored local files or hosting secret stores. Commits use only dotmantissa with the requested email and no coauthor trailers. The [review response](review-response.md) maps the changes to all eleven findings.
