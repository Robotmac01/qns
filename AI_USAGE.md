# AI usage

This project was built with **Claude** (Anthropic) as a pair programmer, directed by the author.

## What the AI did

- **Research.** Read the QoreChain docs, SDK source and Build Before Q-Day example apps to find the
  `pqcVerify` (`0x0a01`) and `pqcKeyStatus` (`0x0a02`) interfaces, the ML-DSA-87 key and signature sizes,
  the EVM authorisation window (including `allowedTargets` scoping) and the QoreX integration limits
  (QoreX doesn't sign arbitrary messages with ML-DSA yet, which led to the guardian-code design).
- **Design.** Proposed the hybrid model (owner tx signature + ML-DSA-87 guardian signature), the signed
  message layout (chain id, contract, action, name, owner, nonce, deadline, payload hash), storing only the
  key hash, the non-ERC-721 decision and fail-closed decoding of the precompile result.
- **Code.** Wrote `QNS.sol`, the precompile stand-in for tests, the test suite, the CLI, the scoped window
  command, the Ignition module and the React app.
- **Checks.** Compiled, ran the tests (22) and the TypeScript checks, built the web app and looked at it in
  a headless browser.
- **Audit follow-up.** Reviewed the QCAI stage 1 findings, fixed the real one (front-running, with
  commit-reveal), answered the false positives with code comments and tests.

## What the author did

- Chose the idea (an ENS-style name service), the track and the scope.
- Ran the deploy, the testnet transactions and the QCAI audits, and reviewed the findings.
- Recorded the demo video and wrote the submission.

## How the output was checked

- Tests use real ML-DSA-87 keys and signatures from `@qorechain/sdk`. The stand-in precompile only
  accepts triples the real verifier accepted first.
- The testnet deployment calls the real `pqcVerify` precompile.
- QCAI audit, two passes (see README and `audits/`).
