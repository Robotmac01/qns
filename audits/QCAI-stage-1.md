# QCAI audit, stage 1 (before fixes)

- **Tool:** QoreChain AI Smart Contract Auditor (dashboard.qorechain.io/audit), testnet
- **Date:** 20 November 2026
- **Source:** `contracts-app/contracts/QNS.sol` as deployed at `0x828a6E483C5A2c83C013B51f6058E987728D2348` (interface inlined)
- **Public report:** https://qorechain-audit-reports-362958365954.s3.amazonaws.com/audits/QCAIA-1795172541719-CBA385BF/report.html
- **Result:** security score 78, risk level Medium, 5 issues

| # | Finding | Severity | Response |
|---|---|---|---|
| 1 | Potential privilege escalation in admin functions: an admin signature could be reused if the nonce isn't enforced across all admin operations | High | **Not an issue.** `adminNonce` is one counter shared by every admin action and is incremented before verification; the action id is inside the signed message. Added a comment and a test that replays a used admin signature for the same action and for another action (both revert `PqcSignatureInvalid`). |
| 2 | Potential overflow in `years_ * YEAR` in `register` and `renew` | Medium | **Not an issue.** `years_` is checked against `MAX_YEARS` (10) before any arithmetic, and Solidity 0.8 reverts on overflow. Made the bound explicit with comments. |
| 3 | Front-running in name registration | Medium | **Fixed.** Added ENS-style commit-reveal: `commit(makeCommitment(label, owner, guardian, secret))`, wait at least 60 s (at most 1 day), then `register(..., secret)`. Tests cover a front-runner without a commitment, a commitment that is too new, too old, and reused. |
| 4 | Unbounded loop in `_validLabel` | Low | **Not an issue.** The length is checked first (3 to 63), so the loop runs at most 63 times. Added a comment. |
| 5 | Not ERC-721 compliant | Info | **By design.** A token standard would add a classical-only `transferFrom` that skips the guardian. |
