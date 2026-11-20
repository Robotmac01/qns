# Submission checklist - Post-Quantum dApp track

Deadline: **2 December 2026, 23:59 UTC**.

## Build and deploy

- [ ] Fresh testnet account; QOR from https://dashboard.qorechain.io/faucet
- [ ] `pnpm test` passes (19)
- [ ] `pnpm window register` then `pnpm window open`
- [ ] `pnpm qns init` then `pnpm deploy:testnet`
- [ ] `QNS_ADDRESS` in `contracts-app/.env` and `VITE_QNS_ADDRESS` in `web/.env`
- [ ] `pnpm window scoped`, then register a name and do one `set-addr` on the testnet
- [ ] Save the tx hashes (register, set-addr) for the README and the video

## QCAI audit (two stages)

- [ ] Stage 1: paste `QNS.sol` at https://dashboard.qorechain.io/audit, export the PDF, make the report public
- [ ] Fix or answer each finding
- [ ] Stage 2: re-run after the fixes, export, make public
- [ ] Link both reports in the README

## Repository (public, on GitHub)

- [ ] README with the contract address, an example name and the tx hashes
- [ ] `LICENSE` (Apache-2.0) at the root
- [ ] Credits section kept (reused template code is credited)
- [ ] `AI_USAGE.md` (needed for Best AI-Native Build)
- [ ] No `.env`, private keys or guardian codes committed

## Media

- [ ] Featured image
- [ ] Video, 3 minutes max. Suggested flow:
  1. The problem (20 s): an ENS name is only as safe as one ECDSA key.
  2. Register `yourname.qore` in the web app with QoreX and a guardian code (40 s).
  3. Q-Day demo (50 s): with only the wallet, try to repoint the name; the contract refuses
     (`WrongGuardian` / `PqcSignatureInvalid`). Then do it with the guardian: it passes.
  4. Show the tx on the explorer and the `pqcVerify` call (30 s).
  5. Scoped window, tests, audit (30 s).

## Optional extras

- [ ] Post progress on X with #BuildBeforeQDay
- [ ] Regional award: choose "Middle East and Africa" when creating the project
