This is the historical record for the earlier suite. See [the current verification record](verification.md) for the replacement contracts.

# Verification record

Checked on 14 October 2026 against GenLayer Studio, chain 61999.

The app is live at https://meter-bill-review.candidtuna3.chatgpt.site. Sites version 3 uses source commit `a14045562541cce1093b3a39126af61deabf5599`. Its production build, type checking, frontend lint and seven privacy tests passed. The published health endpoint confirms the addresses in `deployments/studio.json` and reads the linked recovery pool.

All three contract files pass GenVM lint. The audit produces an import warning for `io`, used only for an in memory PDF buffer. Its runner version is pinned. The direct suite passes 35 cases covering source changes, date gates, schema validation, exact rates, tier rounding, comparison tolerance, appeals, escrow deposits, cancellation and resolution.

The direct runner currently returns an empty sandbox result. A documented adapter executes arithmetic through the VM Return wrapper in unit tests. Independent PDF extraction and the real sandbox are checked separately through Studio transactions. Unit fixtures remain in tests. Live fixtures use `avista.1.selftest`, excluded from the customer tariff library and utility aggregates.

All three final Studio integration cases passed. The live audit reproduced Avista’s base charges at $92.58, with three agreeing validators, one disagreeing validator and one idle validator. Its recheck persisted revision 2. The escrow accepted a real deposit, cancelled the claim, finalized its native refund, and restored the recipient’s exact prior balance. The bonded appeal also persisted its second revision. Selected public receipts and the refund balances are in [deployments/verification.json](../deployments/verification.json).

The hosted browser check found three real tariff records, no page errors, and no horizontal overflow at desktop or mobile widths. It verified navigation, light and dark themes, the email only modal, local PDF extraction, and no outgoing request containing the test bill’s private identity markers. It did not send a login email or complete an actual customer OTP session.

Anonymous calls to saved review and worker endpoints returned 401. The worker was invoked with its intended service credential and saved run `4e45af25-c88d-4136-8b4a-c118cb320b87` in Neon. Reading the protected status endpoint returned the same completed run with no error. Zero reviews were due; no customer bills were manufactured for this check.

The linked task `Automation_4b813f0256bc8191ac2361ddc16947da` is enabled hourly in Africa/Lagos time. Per review consent and monthly due dates determine what the worker processes. The task was saved and the writer was exercised independently; no claim is made that the first scheduled occurrence has run.

Tracked source, new source files and the final production archive were scanned against the supplied credentials and generated signing and worker secrets. No matches were found. Runtime configuration stays in ignored files or the hosting secret store. The recovery checklist and agent instructions are ignored, and Git history is checked for the sole requested author.

## Vercel

The native Next.js deployment is available at https://meter-audit.vercel.app. It uses Node 22, the `web` project root, and a dedicated TypeScript configuration for application sources. The build, type check, frontend lint, and seven privacy tests passed. The hosted browser check repeated desktop, mobile, theme, navigation, email modal, and local PDF privacy checks with no page errors or failed assets.

The live tariff endpoint returned three indexed records. Health returned the current Studio contract addresses and read the linked escrow pool. Anonymous review and worker requests returned 401. Authorized worker status returned a completed saved run from the shared Neon database. The existing Sites task continues to process that same queue.

All nine production configuration values were stored as sensitive Vercel environment entries. The upload list and native browser bundle passed credential scans. No credentials were supplied as command arguments. The first remote build exposed a shared type check referencing an excluded Sites helper; the corrected deployment passed with the application scope. Deployment identifiers and public check results are in [deployments/vercel.json](../deployments/vercel.json).

The navigation header stays at the top while scrolling. The published change was checked at desktop and mobile widths, including section anchor offsets, dark theme, the mobile menu, and privacy and verdict layouts. Interactive checks wait for the client to finish loading before clicking.
