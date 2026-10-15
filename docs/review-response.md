# Review changes

The review led to a replacement contract suite, a database migration, and changes to the app and recurring worker. Old contract addresses remain attached to legacy records. Existing deposits retain their cancellation path.

1. Each action now has its own operation ID, transaction hash and status. Atomic reservations serialize submissions. Refreshing an action cannot fall back to the original audit receipt. The canonical first execution receipt determines success.
2. Finalized reports continue reading finalized contract state. A revision guard prevents older responses overwriting newer results. Read failures disclose the cached snapshot and its last synchronization. Downloads and printed reports retain that context.
3. Auxiliary failures leave the original audit status intact. Claim inspection and cancellation consult the actual escrow, including when the indexed verdict cannot be displayed.
4. Recovery controls remain visible after a correction. A material correction queues escrow synchronization after finalization, which queues the native refund. Anyone can retry synchronization safely. The UI distinguishes a queued payout from received funds.
5. Settlement compares material verdict hashes rather than revision numbers. Repeated confirmations preserve eligibility. Partial recovery releases a proportional fee and refunds the remainder, with separate operator and depositor recipients.
6. The registry preserves the original public PDF bytes. Historical reviews verify and use those archives while new audits still require matching live sources and valid dates. Controlled legacy import requires ownership and all three original hashes to match. A missing historical document cannot be reconstructed from its hash.
7. Every new revision is retained through a public paginated history. Correction markers survive unchanged confirmations. Legacy import explicitly preserves the last available snapshot and identifies its original contract and revision, without inventing missing history.
8. Owners receive one scheduled confirmation every 30 days. Earlier reconsideration requires a bond. Public bonded challenges can repeat after a separate one hour cooldown for each caller; there is no shared single use slot.
9. Confirmed failed, canceled and undetermined source jobs enter retry backoff. Unknown broadcasts remain separate. A late known hash can reconcile the same reserved attempt without attaching an earlier attempt's receipt.
10. Sponsorship reserves the user grant and shared daily allowance in one PostgreSQL function. The shared row serializes concurrent requests. The live Neon concurrency test uses an isolated temporary schema and spends no funds.
11. Validators receive all extracted pages, with explicit size limits that reject oversized evidence instead of sampling. The bundle includes a pinned pure Python AES provider for public encrypted PDFs. Parser tests cover middle pages, oversized text, known encryption vectors and actual encrypted PDFs. Fresh Studio cases exercise every advertised utility, both tier boundaries and service types, with the actual model, parser and sandbox.

The [verification record](verification.md) and [public receipts](../deployments/review-verification.json) distinguish fresh utility adjudication from the separate controlled revision driver used to exercise native escrow refunds. The driver cannot update a Meter verdict. Tests use isolated synthetic facts; none are planted in the app's review index or public utility aggregates.

The shared back to top button appears after scrolling, supports keyboard activation, and respects reduced motion. The sticky navigation, themes, email modal and local PDF privacy were checked on both hosted apps.
