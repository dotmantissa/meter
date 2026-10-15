# Meter

The utility owns the meter, reads the meter, and writes the bill. Meter gives you a second pair of eyes.

[Open Meter](https://meter-audit.vercel.app)

Bring a PDF electricity bill. Meter reads it in your browser, lets you check the numbers, and asks independent GenLayer validators to compare them with the published tariff. The answer keeps its working and the fingerprints of its evidence. You can print it, download it, or share a verdict page with your utility.

No sample bills are planted in the app. The tariff library is indexed from the deployed registry. Reviews appear only after someone submits facts and the network produces a result.

## What the first version checks

Meter starts with ordinary residential electricity in Washington: Puget Sound Energy Schedule 7, Avista Schedule 1, and Pacific Power Schedule 16. Each entry links the utility sheet, the tariff filed with the Washington Utilities and Transportation Commission, and its regulatory approval record.

The verdict covers the base customer and energy subtotal. It does not call an entire bill correct when only those charges were checked. Riders, taxes, debt, assistance discounts, net metering, time of use plans, partial months, and periods spanning a rate change need more rules. Water, gas, telecom, and demand charges need their own source coverage before they belong in this interface.

Tariff PDFs are awkward enough without pretending otherwise. An unreadable document, a changed fingerprint, an unsupported plan, or missing effective date evidence blocks a calculation or produces an inconclusive result.

## What makes the verdict independent

The registry preserves the complete public PDFs alongside their SHA256 fingerprints under strict equivalence. New audits require the current published bytes to match. If a utility replaces a PDF, earlier reviews can still be challenged against their original archived evidence. Dates remain binding in both cases. An existing verdict never depends on a disappearing download link.

Each validator reads every page of those PDF bytes and independently extracts the rate parameters. Evidence exceeding the explicit document or text limits is rejected, never sampled. Parameters and error classification must match exactly. Integer arithmetic runs inside a GenVM sandbox and totals are compared within 0.5 percent. The deterministic caller then calculates the persisted amounts again, with component rounding to cents.

This deliberately reapplies the reasoning pattern behind Verdant to household billing. The reference documents, counterparty, dispute, and money flow are different. A useful pattern deserves a second useful job.

## Privacy and access

The original PDF, extracted text, name, address, and utility account number stay in the browser. The API accepts a fixed schema of tariff identifiers, dates, usage, service type, charge amounts, and a fingerprint of the original. Extra fields are rejected.

Those submitted facts become public contract data. A fingerprint proves a commitment to a document; it does not prove that the owner entered every number correctly. Keep the original bill for a utility or regulator to inspect.

Privy handles email access. The server verifies sessions and signs Studio transactions for each user. There are no wallet login options or transaction popups. Neon is an index and a job store, never the authority for a verdict. Sharing an app page is optional and can be turned off. The underlying contract record remains public.

## Appeals and recovery

A bonded challenge starts another consensus transaction. Every revision is retained, and a correction stays visible after later confirmations. Challenges cost 0.001 Studio GEN and each caller must wait one hour between challenges to the same review. There is no shared appeal slot for someone else to use up. Owners may also request one scheduled confirmation every 30 days without a bond. Earlier reconsideration requires a bond, including for the owner. A material correction queues return of the challenge bond after finalization. GenLayer chooses the panel; the app cannot guarantee that every validator is a new identity.

The recovery contract holds a success fee for disputes of at least $10 in base charges. It requires an actual attached Studio deposit. An operator attests how much the utility credited; that external statement is an explicit trust boundary. The released fee is proportional to recovery, capped at the deposit. Recovering one cent of a $20 dispute releases 0.05 percent of the fee, with the remainder refunded. A confirmation with identical material results preserves fee eligibility even when its revision changes.

A material correction automatically queues escrow synchronization after finalization. That synchronization queues a full native refund. These are separate transactions, so a corrected verdict alone is not proof of a completed payout. Anyone can retry the idempotent synchronization, and the owner can cancel an open claim. Claim controls remain visible after a correction or a failed appeal. This deployment does not advance dollars or operate a funded fiat claims pool. Studio tokens have no stated dollar value.

The supplied operator account sponsors small Studio bond deposits. A shared database reservation enforces at most 100 sponsorship grants per day, with at most one per user. Concurrent requests use the same locked allowance. An uncertain broadcast needs reconciliation before another attempt. Signing material stays on the server.

## Running it

Use Node 22 and Python 3.13 or newer. Copy `.env.example` to `.env` for scripts and `web/.env.example` to `web/.env` for the app. Fill the server settings and give both files permissions of 600. Use a separate stable user signing seed. Never commit credentials.

```sh
npm --prefix web ci
python3 -m pip install -r requirements.txt
python3 scripts/migrate.py
npm --prefix web run dev
```

The web app uses Next.js App Router components and routes, with Vinext for the Sites Worker runtime. Its production build preserves the hosting adapter. Fonts and the PDF worker are served with the app. The logo is an original vector drawing of a meter with an independent needle.

Vercel runs the same app through native Next.js. Its project root is `web`, Node is pinned to version 22, and `web/vercel.json` selects `npm run build:vercel`. Keep the database, Privy secret, operator key, stable user signing seed, worker credential, and contract addresses in production environment settings. The upload rules exclude local credentials, tool state, and the recovery checklist.

```sh
npm --prefix web run build:vercel
npm --prefix web run start:vercel
```

```sh
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web test
gltest tests/direct -v
```

Direct tests cover each contract, including tier boundaries, changed documents, privacy schema rejection, validator disagreement, appeal bonds, and escrow accounting. The direct runner needs a documented sandbox adapter; the Studio integration checks exercise the real sandbox, live PDFs, and independent validator agreement.

```sh
python3 scripts/package_contract.py
node scripts/deploy.mjs
node --experimental-strip-types scripts/register-tariffs.mjs
python3 scripts/index_tariffs.py
node scripts/studio-proof.mjs
node scripts/studio-refunds.mjs
METER_STUDIO_PROOF_REPLAY=1 gltest tests/integration -v -s --network studionet
```

The PDF reader is pinned to pypdf 6.10.2. A pinned pyaes 1.6.1 provider reads public PDFs that use AES without requiring native extensions. Both licenses ship inside the contract archive. GenVM requires stored ZIP entries. Its immutable module source is compressed within small standard library bootstraps to fit Studio upload limits. Deployment metadata makes the archive reproducible. The library license is included in the package.

Running the integration suite without the replay setting submits a fresh run with a new identifier. Use `METER_PROOF_RUN` to resume a named run. The replay setting above checks receipts and state only after the preceding scripts have submitted and verified their transactions.

The fresh Studio proof submits independent audits for all three utilities, including tier boundaries and dwelling types. It uses separate test tariff IDs. Its synthetic inputs never enter the app’s utility aggregates or saved review index. The proof runner saves each transaction hash before polling and can resume an interrupted run. A separate isolated driver exercises actual native escrow refunds after controlled corrections. It cannot write an application verdict and does not stand in for the three utility consensus tests.

## Keeping an eye on the next bill

Monthly checks require consent. The worker refreshes source fingerprints, waits for a successful finalized refresh, and rechecks the anonymous facts already provided. It never invents the next month’s usage. Upload the next bill when it arrives.

The worker keeps leases, submission receipts, and recovery states in Neon. Confirmed failed, canceled, or undetermined source refreshes enter a recoverable backoff state. An uncertain broadcast is not blindly repeated. Each action has its own receipt and lock; a failed appeal cannot invalidate an earlier verdict. Finalized reports continue reading finalized contract state, including revisions submitted directly through Studio. Saved snapshots disclose synchronization failures. Source changes stay visible in saved reviews. The hosted owner tool runs the worker. The protected HTTP endpoint supports a Site service access credential or a separate worker credential, both held in the hosting secret store. Its status endpoint reads the latest saved run. An enabled Sites task checks the queue hourly in Africa/Lagos time; each consenting review becomes due monthly. That task continues through the existing Sites service, sharing the same database and signing seed as the Vercel app.

Legacy reviews keep their original contract addresses and cancellation route. Moving one to the replacement contract requires the owner, no open legacy deposit, and all three original evidence hashes matching the archive. The latest legacy snapshot is retained before a fresh adjudication; missing older history is never invented.

Public aggregate counts come from contract state and identify the reviewed scope. They count submitted facts, including direct contract submissions. They are not proof that a utility committed misconduct.

Deployment addresses, source fingerprints, and transaction receipts are in [deployments/studio.json](deployments/studio.json). The implementation boundary is described in [docs/architecture.md](docs/architecture.md), and the checked results are in [docs/verification.md](docs/verification.md). The [review response](docs/review-response.md) maps each reported issue to its correction.

The Vercel deployment and alias are recorded in [deployments/vercel.json](deployments/vercel.json). The [Sites deployment](https://meter-bill-review.candidtuna3.chatgpt.site) remains available.
