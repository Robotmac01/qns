# QNS - Qore Name Service

**`.qore` names for QoreChain that survive Q-Day.**

QNS turns a long `0x` address into a name like `james.qore`, like ENS does on Ethereum. The difference is
what protects it. On ENS, whoever holds your ECDSA key owns your name. A quantum computer that recovers
that key from a public signature can take the name and reroute every payment sent to it.

On QNS, the actions a thief wants all need **two signatures**:

1. the owner's normal account signature on the transaction (secp256k1), **and**
2. an **ML-DSA-87** (FIPS 204) signature from the name's **guardian key**, checked inside the contract by
   QoreChain's `pqcVerify` precompile (`0x0a01`).

| Action | Protection |
| --- | --- |
| Point the name at a new address (`setAddr`) | owner + ML-DSA-87 guardian |
| Transfer the name (`transfer`) | owner + ML-DSA-87 guardian |
| Replace the guardian (`rotateGuardian`) | owner + old guardian + proof of possession by the new key |
| Withdraw fees, change prices, change admin | admin + ML-DSA-87 admin guardian |
| Register | commit-reveal (60 s wait, stops front-running) + proof of possession by the guardian key, or the account's own on-chain PQC key via `pqcKeyStatus` |
| Text records, primary name, renew | classical (low risk, kept cheap) |

Built for **Build Before Q-Day** (QoreChain Developer Fest), **Post-Quantum dApp** track. #BuildBeforeQDay

## Testnet deployment

| | |
| --- | --- |
| Network | QoreChain testnet `qorechain-diana`, EVM chain id 9800 |
| QNS contract (v2, after audit fixes) | [`0x6f23Dc0Ab6CB9dbE24dcf068b3ae424d8Be19c3E`](https://explore.qore.network/address/0x6f23Dc0Ab6CB9dbE24dcf068b3ae424d8Be19c3E) |
| QNS contract (v1) | [`0x828a6E483C5A2c83C013B51f6058E987728D2348`](https://explore.qore.network/address/0x828a6E483C5A2c83C013B51f6058E987728D2348) |
| Example name | `okafor.qore` → `0xcf8239ff696253a5ec21b4d7db9fd6d43c3cd35f` (`qor1e7prnlmfvff6tmppkntah87k6s7re56ldawxpp`), set with a post-quantum guarded [`setAddr`](https://explore.qore.network/tx/0x18706d4a56b9f03ec5e2e156560e0cc0cf3f9205750be4f2ff4e183c45d5329e) |
| Live app | https://qns-two.vercel.app |
| Demo video | https://youtu.be/3eGpXKgE-rY |
| Explorer | https://explore.qore.network |

## How it works

```text
guardian code (QRC1-…)  --derive-->  ML-DSA-87 key pair  (never stored, never sent)
                                             |
contract.authMessage(action, name, owner, nonce, deadline, payloadHash)
                                             |
                               sign with ML-DSA-87 (4,627 bytes)
                                             |
   owner's EVM tx  ->  QNS.setAddr(..., pubkey, signature)  ->  pqcVerify (0x0a01)  ->  OK / revert
```

- **Every signed message is bound** to the chain id, the contract, the action, the name, the current
  owner, a per-name nonce, a deadline (max 1 hour ahead) and the exact new values. A signature can't be
  replayed, reused for another name or action, or carried to another deployment.
- **Only a hash of the guardian key is stored** (32 bytes). The 2,592-byte public key comes with each call
  and must hash to it.
- **Names are not ERC-721 tokens on purpose.** A token standard would add a classical-only
  `transferFrom` that skips the guardian.
- **No front-running.** Registration is commit-reveal, as on ENS: commit a hash of name, owner, guardian
  and a secret, wait 60 seconds, then register.
- **Fails closed.** If `pqcVerify` is not active (an inactive precompile returns empty data), every
  guarded action reverts.
- **Two ways to choose a guardian.** A separate guardian code (works with QoreX in the browser today, since
  QoreX doesn't sign arbitrary messages with ML-DSA yet), or, from the CLI, the account's **own registered
  ML-DSA-87 key**, read on chain through `pqcKeyStatus` (`0x0a02`) and only accepted with a proven
  possession.
- **Scoped EVM window.** `pnpm window scoped` opens QoreChain's EVM authorisation window with
  `allowedTargets = [QNS]`, so even a leaked classical key can only call QNS, where the guardian still
  blocks it.

## Repository

| Folder | What |
| --- | --- |
| `contracts-app/contracts/QNS.sol` | the registry and resolver |
| `contracts-app/contracts/interfaces/IQorePQC.sol` | QoreChain PQC precompile interface |
| `contracts-app/test/QNS.ts` | 22 tests, with real ML-DSA-87 keys and signatures |
| `contracts-app/scripts/qns.ts` | CLI: register, resolve, set-addr, transfer, withdraw |
| `contracts-app/scripts/window.ts` | register the account's PQC key, open a normal or scoped EVM window |
| `contracts-app/ignition/modules/QNS.ts` | Hardhat Ignition deploy |
| `web/` | Vite + React + wagmi + RainbowKit app with QoreX; ML-DSA-87 signing in the browser |

## Run it

You need Node.js 22+ and pnpm. Use a **throwaway testnet account** only. Get test QOR at
https://dashboard.qorechain.io/faucet.

### Contracts

```sh
cd contracts-app
pnpm install
cp .env.example .env            # PRIVATE_KEY of a fresh testnet account
pnpm test                       # 22 passing

pnpm window recovery-code       # -> QORE_PQC_RECOVERY_CODE in .env (the account's own PQC key)
pnpm window register            # bind the account's ML-DSA-87 key (once)
pnpm qns guardian-code          # -> QNS_ADMIN_GUARDIAN_CODE in .env
pnpm qns init                   # writes ignition/parameters.json
pnpm window open                # unscoped window: needed to deploy
pnpm deploy:testnet
```

Put the deployed address in `.env` as `QNS_ADDRESS`, then:

```sh
pnpm qns guardian-code          # -> QNS_GUARDIAN_CODE (guards your names; write it on paper)
pnpm window scoped              # window that only admits calls to QNS
pnpm qns price okafor
pnpm qns register okafor 1      # commits, waits 65 s, registers (or add --account-key)
pnpm qns info okafor
pnpm qns set-addr okafor 0x…    # post-quantum guarded
pnpm qns resolve okafor
```

### Web

```sh
cd web
pnpm install
cp .env.example .env            # VITE_QNS_ADDRESS=0x…
pnpm dev                        # http://localhost:5175
```

Connect QoreX on the testnet, create or paste a guardian code, search a name, start the timer, wait a minute, register. The guardian
code stays in the tab's memory and is never stored or sent.

## Tests

`pnpm test` runs on Hardhat's simulated network, which has no QoreChain precompiles. The tests place a
small stand-in at `0x0a01` / `0x0a02` (`contracts/test/PqcPrecompileStandIn.sol`). It does no maths
itself: the harness signs with a **real ML-DSA-87 key** (`pqcSign` from `@qorechain/sdk`), verifies with
the **real verifier** (`pqcVerify`), and only then records that exact (key, signature, message) as valid.
Tampered messages, other keys and replays get `false`, as on chain. On the testnet the contract calls the
real precompile; the bytecode is the same.

Covered: registration and pricing, label rules, proof of possession, the `pqcKeyStatus` path, the
**Q-Day scenario** (attacker with the owner's classical key can't redirect the name), front-running
(commit-reveal), admin and per-name replay and
cross-action reuse, deadlines, transfer with a new guardian, guardian rotation, expiry and grace period,
fail-closed with an inactive precompile, admin actions.

## Security notes

- The **guardian code** is a second secret. If you lose it, you can still renew, but you can no longer
  move the name or change where it points. Write it down.
- Low-risk records (text, primary name) are classical by design. Payment routing is not.
- A guarded call carries about 7 KB of key and signature. Expect roughly 300k gas plus the precompile's
  ~85-90k on QoreChain.
- Not audited. Testnet only. See the QCAI audit reports linked below.

## QCAI audit

Run with the QoreChain AI Smart Contract Auditor (dashboard.qorechain.io/audit).

- Stage 1, before fixes: [public report](https://qorechain-audit-reports-362958365954.s3.amazonaws.com/audits/QCAIA-1795172541719-CBA385BF/report.html), [findings and responses](audits/QCAI-stage-1.md). Score 78, Medium, 5 findings. One real issue
  (front-running at registration) fixed with commit-reveal; the rest answered in the report.
- Stage 2, after fixes: [public report](https://qorechain-audit-reports-362958365954.s3.amazonaws.com/audits/QCAIA-1795175304137-55ED5F0A/report.html), [findings and responses](audits/QCAI-stage-2.md). Score 82, Medium, 6 findings.
  Front-running dropped to Low; no new real issues.

## Credits

- Project scaffold, `scripts/window.ts`, the Hardhat config and the wagmi/QoreX setup are adapted from
  QoreChain's open source [build-before-qday](https://github.com/qorechain/build-before-qday) workshop
  apps and the [`create-qorechain-dapp`](https://github.com/qorechain/qorechain-sdk) Hardhat template
  (Apache-2.0).
- `@qorechain/sdk`, `@qorechain/evm`, `@qorechain/qorex-rainbowkit`: QoreChain Association (Apache-2.0).
- `@noble/hashes`, `@noble/post-quantum` (via the SDK): Paul Miller (MIT).
- Hardhat, viem, wagmi, RainbowKit: their respective authors (MIT).
- The naming model (`namehash`, resolver records, reverse names) follows ENS. No ENS code is used.

## Licence

Apache-2.0. See `LICENSE`.
