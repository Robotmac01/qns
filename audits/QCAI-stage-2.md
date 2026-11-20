# QCAI audit, stage 2 (after fixes)

- **Tool:** QoreChain AI Smart Contract Auditor (dashboard.qorechain.io/audit), testnet
- **Date:** 20 November 2026
- **Source:** `contracts-app/contracts/QNS.sol` as deployed at `0x6f23Dc0Ab6CB9dbE24dcf068b3ae424d8Be19c3E` (interface inlined)
- **Public report:** https://qorechain-audit-reports-362958365954.s3.amazonaws.com/audits/QCAIA-1795175304137-55ED5F0A/report.html
- **Result:** security score 82 (stage 1: 78), risk level Medium, 6 issues (1 high, 3 medium, 2 low)

Front-running, the one real stage 1 finding, dropped from Medium to Low after the commit-reveal fix.

| # | Finding | Severity | Response |
|---|---|---|---|
| 1 | Reentrancy in admin functions could increment `adminNonce` twice and allow signature replay | High | **Not an issue.** The nonce is read and incremented once, before verification, and the only external call (`withdraw`'s transfer) runs under `nonReentrant` after it. A re-entered admin call would need a fresh signature over the new nonce. The replay test from stage 1 covers this. |
| 2 | `transferAdmin` doesn't check that the new admin has a PQC key | Medium | **By design.** Admin power is held by `adminGuardian`, an ML-DSA-87 key hash set in the same signed call. The new admin address only sends the transaction; it can't act without the guardian signature. |
| 3 | Overflow in `years_ * YEAR` | Medium | **Not an issue.** Same as stage 1: `years_` is capped at `MAX_YEARS` (10) first, and Solidity 0.8 reverts on overflow. |
| 4 | Precompile return values not fully checked | Low | **Not an issue.** `_verify` reverts unless the call succeeds, returns exactly 32 bytes and decodes to 1; `pqcKeyStatus` reverts unless it returns at least 128 bytes. Empty data (no precompile) fails closed. |
| 5 | Front-running still possible in the commitment window | Low | **Not an issue.** A commitment hashes the label, the committer's address, guardian and secret, so it can't be reused by an observer. An attacker would need their own commitment made before the victim's and still has to wait 60 s. Same model as ENS. |
| 6 | Unbounded growth of `_texts` and `commitments` | Medium | **Accepted.** Normal for a name service: each entry is paid for by the account that writes it and no function loops over these mappings. A used commitment is deleted on `register`. |
