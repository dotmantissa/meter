# Meter architecture

The browser reads a bill locally with PDF.js, hashes the original bytes, and lets its owner check the extracted quantities. It sends a fixed schema of numeric facts and public tariff identifiers. There is no upload endpoint and no field for a name, address, account number, raw text or document.

Privy verifies email access. The server verifies the token before accepting a request, enforces a per user quota in Neon, and relays transactions through the Studio account. Neon holds anonymous facts, operation receipts, consent settings and indexes. Contract state remains authoritative. Public reports are opt in. Publishing a report can reveal a household's usage pattern even without a name.

The registry hashes the current utility sheet, filed UTC schedule, and approving order under strict equivalence. Owner curated entries establish a bounded source catalog. Every audit independently extracts applicability, dates and numeric rates from those exact PDF bytes. An altered document blocks adjudication. Historical entries retain their hashes; replacement evidence requires a new entry. A bill must lie entirely within its tariff interval.

The audit compares independently extracted parameters and classification exactly. Arithmetic uses integer micro dollars and Wh inside a sandbox, rounds component amounts half up to cents, and compares totals within 0.5 percent. A second sandbox in the deterministic caller rederives the persisted result after consensus. Unsupported applicability or missing evidence produces an inconclusive verdict, never a clean bill.

An appeal posts a Studio GEN bond and starts another consensus transaction. The network chooses the panel; application code cannot promise disjoint validator identities. Changed results refund the bond on finalization. The protocol's transaction appeal is also available through Studio. Reports retain the previous classification and revision.

Recovery uses a success fee escrow with actual attached Studio native value. Only an audit owner can open an eligible claim. The operator attests an off network utility credit; this attestation is explicitly trusted. Revised verdicts refund deposits instead of releasing fees. Depositors can cancel an open claim. No contract claims to send US dollars, issue a utility credit, or operate a funded fiat advance pool.

Recurring consent causes the worker to refresh the tariff evidence and alert an existing review when sources change. It does not infer next month's usage. A new monthly bill requires a fresh private browser extraction. Rechecks use retained anonymous facts only. The worker never downloads a private bill.
