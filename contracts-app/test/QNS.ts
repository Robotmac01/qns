import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, keccak256, parseEther, toHex, zeroHash, type Address, type Hex } from "viem";
import { generatePqcKeypair, pqcVerify, type PqcKeypair } from "@qorechain/sdk";

import { ACTIONS, guardianFromCode, guardianHash, hexToU8, newGuardianCode, signAuth } from "../scripts/lib/guardian.js";

const PQC_VERIFY = "0x0000000000000000000000000000000000000a01" as Address;
const PQC_KEY_STATUS = "0x0000000000000000000000000000000000000a02" as Address;
const PRICES = [parseEther("20"), parseEther("5"), parseEther("1")] as const;
const YEAR = 365n * 24n * 3600n;

describe("QNS - Qore Name Service", async () => {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [deployer, alice, bob, mallory] = await viem.getWalletClients();

  // Real ML-DSA-87 keys (FIPS 204), generated once - keygen in pure TS takes a moment.
  let adminKey: PqcKeypair;
  let aliceKey: PqcKeypair;
  let bobKey: PqcKeypair;
  let malloryKey: PqcKeypair;

  before(async () => {
    adminKey = guardianFromCode(newGuardianCode());
    aliceKey = guardianFromCode(newGuardianCode());
    bobKey = generatePqcKeypair();
    malloryKey = generatePqcKeypair();
  });

  /** Put the precompile stand-in at 0x0a01 and 0x0a02 (see contracts/test). */
  async function installPrecompiles() {
    const standIn = await viem.deployContract("PqcPrecompileStandIn");
    const code = await publicClient.getCode({ address: standIn.address });
    await networkHelpers.setCode(PQC_VERIFY, code!);
    await networkHelpers.setCode(PQC_KEY_STATUS, code!);
    return {
      verifier: await viem.getContractAt("PqcPrecompileStandIn", PQC_VERIFY),
      keyStatus: await viem.getContractAt("PqcPrecompileStandIn", PQC_KEY_STATUS),
    };
  }

  async function deploy() {
    const pre = await installPrecompiles();
    const qns = await viem.deployContract("QNS", [guardianHash(adminKey), [...PRICES]]);
    const now = async () => (await publicClient.getBlock()).timestamp;

    /**
     * Sign `message` with a real ML-DSA-87 key, verify it with the real
     * verifier, and only then tell the stand-in precompile the triple is valid.
     */
    async function pqSign(kp: PqcKeypair, message: Hex) {
      const { pubkey, signature } = signAuth(kp, message);
      assert.ok(pqcVerify(kp.publicKey, hexToU8(message), hexToU8(signature)));
      const triple = keccak256(
        encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }, { type: "bytes" }], [pubkey, signature, message]),
      );
      await pre.verifier.write.recordVerified([triple]);
      return { pubkey, signature };
    }

    async function auth(kp: PqcKeypair, action: number, node: Hex, owner: Address, payloadHash: Hex) {
      const deadline = (await now()) + 600n;
      const nonce = node === zeroHash ? await qns.read.adminNonce() : (await qns.read.recordOf([node])).nonce;
      const msg = await qns.read.authMessage([action, node, owner, nonce, deadline, payloadHash]);
      return { ...(await pqSign(kp, msg)), deadline };
    }

    const SECRET = keccak256(toHex("qns-test-secret"));

    /** Step 1 of registration: commit, then wait out MIN_COMMITMENT_AGE. */
    async function commitFor(label: string, who: typeof alice, guardian: Hex, secret = SECRET, wait = 61) {
      const c = await qns.read.makeCommitment([label, who.account.address, guardian, secret]);
      await qns.write.commit([c], { account: who.account });
      if (wait) await networkHelpers.time.increase(wait);
      return c;
    }

    async function register(label: string, who = alice, kp = aliceKey, years = 1n) {
      await commitFor(label, who, guardianHash(kp));
      const node = await qns.read.nodeOf([label]);
      const deadline = (await now()) + 600n;
      const gh = guardianHash(kp);
      const msg = await qns.read.authMessage([ACTIONS.REGISTER, node, who.account.address, 0n, deadline, gh]);
      const { pubkey, signature } = await pqSign(kp, msg);
      const value = await qns.read.rentPrice([label, years]);
      await qns.write.register([label, years, pubkey, signature, deadline, SECRET], { value, account: who.account });
      return node;
    }

    return { qns, pre, auth, register, pqSign, now, commitFor, SECRET };
  }

  const enc = (types: { type: string }[], values: unknown[]) => keccak256(encodeAbiParameters(types, values));

  describe("registration", () => {
    it("registers a name, points it at the owner and sets the primary name", async () => {
      const { qns, register } = await deploy();
      const node = await register("okafor");
      const r = await qns.read.recordOf([node]);
      assert.equal(r.owner.toLowerCase(), alice.account.address.toLowerCase());
      assert.equal(r.guardian, guardianHash(aliceKey));
      assert.equal((await qns.read.resolve(["okafor"])).toLowerCase(), alice.account.address.toLowerCase());
      assert.equal(await qns.read.nameOf([alice.account.address]), "okafor.qore");
      assert.equal(await qns.read.available(["okafor"]), false);
    });

    it("refunds overpayment and keeps the price", async () => {
      const { qns, auth, commitFor, SECRET } = await deploy();
      await commitFor("refund", alice, guardianHash(aliceKey));
      const node = await qns.read.nodeOf(["refund"]);
      const a = await auth(aliceKey, ACTIONS.REGISTER, node, alice.account.address, guardianHash(aliceKey));
      // REGISTER signs with nonce 0 (the record does not exist yet), which `auth` reads.
      const before = await publicClient.getBalance({ address: qns.address });
      await qns.write.register(["refund", 1n, a.pubkey, a.signature, a.deadline, SECRET], {
        value: parseEther("3"),
        account: alice.account,
      });
      assert.equal((await publicClient.getBalance({ address: qns.address })) - before, PRICES[2]);
    });

    it("prices by length: 3, 4 and 5+ characters", async () => {
      const { qns } = await deploy();
      assert.equal(await qns.read.rentPrice(["abc", 2n]), PRICES[0] * 2n);
      assert.equal(await qns.read.rentPrice(["abcd", 1n]), PRICES[1]);
      assert.equal(await qns.read.rentPrice(["abcdef", 1n]), PRICES[2]);
    });

    it("rejects bad labels, taken names and underpayment", async () => {
      const { qns, register } = await deploy();
      for (const bad of ["ab", "Okafor", "-ok", "ok-", "ok_k", "a".repeat(64)]) {
        await viem.assertions.revertWithCustomError(
          qns.write.register([bad, 1n, "0x", "0x", 0n, zeroHash], { value: parseEther("50"), account: alice.account }),
          qns,
          "InvalidLabel",
        );
      }
      await register("taken");
      await viem.assertions.revertWithCustomError(
        qns.write.register(["taken", 1n, "0x", "0x", 0n, zeroHash], { value: parseEther("50"), account: bob.account }),
        qns,
        "NotAvailable",
      );
      await viem.assertions.revertWithCustomError(
        qns.write.register(["cheap", 1n, "0x", "0x", 0n, zeroHash], { value: 1n, account: bob.account }),
        qns,
        "InsufficientPayment",
      );
    });

    it("refuses a guardian key the registrant cannot prove it holds", async () => {
      const { qns, now, commitFor, SECRET } = await deploy();
      await commitFor("stolenkey", mallory, guardianHash(aliceKey));
      const node = await qns.read.nodeOf(["stolenkey"]);
      const deadline = (await now()) + 600n;
      // Mallory names Alice's public key as guardian but can only sign with her own key.
      const msg = await qns.read.authMessage([ACTIONS.REGISTER, node, mallory.account.address, 0n, deadline, guardianHash(aliceKey)]);
      const { signature } = signAuth(malloryKey, msg);
      await viem.assertions.revertWithCustomError(
        qns.write.register(["stolenkey", 1n, toHex(aliceKey.publicKey), signature, deadline, SECRET], {
          value: parseEther("1"),
          account: mallory.account,
        }),
        qns,
        "PqcSignatureInvalid",
      );
    });

    it("can use the account's own on-chain PQC key (pqcKeyStatus) as guardian", async () => {
      const { qns, pre, commitFor, SECRET } = await deploy();
      const pk = toHex(bobKey.publicKey);
      await commitFor("bobby", bob, zeroHash);
      await viem.assertions.revertWithCustomError(
        qns.write.register(["bobby", 1n, "0x", "0x", 0n, SECRET], { value: parseEther("1"), account: bob.account }),
        qns,
        "AccountKeyMissing",
      );
      // Registered but without a proof of possession: still refused.
      await pre.keyStatus.write.setKeyStatus([bob.account.address, true, 1, pk, false]);
      await viem.assertions.revertWithCustomError(
        qns.write.register(["bobby", 1n, "0x", "0x", 0n, SECRET], { value: parseEther("1"), account: bob.account }),
        qns,
        "AccountKeyMissing",
      );
      await pre.keyStatus.write.setKeyStatus([bob.account.address, true, 1, pk, true]);
      await qns.write.register(["bobby", 1n, "0x", "0x", 0n, SECRET], { value: parseEther("1"), account: bob.account });
      const r = await qns.read.recordOf([await qns.read.nodeOf(["bobby"])]);
      assert.equal(r.guardian, keccak256(pk));
    });

    it("front-running: a name can only be registered by whoever committed to it", async () => {
      const { qns, auth, commitFor, SECRET } = await deploy();
      await commitFor("wanted", alice, guardianHash(aliceKey));
      // Mallory sees Alice's register tx in the mempool and copies the label,
      // but has no commitment of her own that has aged long enough.
      const node = await qns.read.nodeOf(["wanted"]);
      const m = await auth(malloryKey, ACTIONS.REGISTER, node, mallory.account.address, guardianHash(malloryKey));
      await viem.assertions.revertWithCustomError(
        qns.write.register(["wanted", 1n, m.pubkey, m.signature, m.deadline, SECRET], {
          value: parseEther("1"),
          account: mallory.account,
        }),
        qns,
        "CommitmentMissing",
      );
      // A fresh commitment is not enough either: it must be at least 60 s old.
      await commitFor("wanted", mallory, guardianHash(malloryKey), SECRET, 0);
      const m2 = await auth(malloryKey, ACTIONS.REGISTER, node, mallory.account.address, guardianHash(malloryKey));
      await viem.assertions.revertWithCustomError(
        qns.write.register(["wanted", 1n, m2.pubkey, m2.signature, m2.deadline, SECRET], {
          value: parseEther("1"),
          account: mallory.account,
        }),
        qns,
        "CommitmentTooNew",
      );
      // Alice's own reveal goes through.
      const a = await auth(aliceKey, ACTIONS.REGISTER, node, alice.account.address, guardianHash(aliceKey));
      await qns.write.register(["wanted", 1n, a.pubkey, a.signature, a.deadline, SECRET], {
        value: parseEther("1"),
        account: alice.account,
      });
      assert.equal((await qns.read.recordOf([node])).owner.toLowerCase(), alice.account.address.toLowerCase());
    });

    it("rejects commitments older than a day and a reused commitment", async () => {
      const { qns, auth, commitFor, SECRET } = await deploy();
      await commitFor("stale", alice, guardianHash(aliceKey), SECRET, 24 * 3600 + 10);
      const node = await qns.read.nodeOf(["stale"]);
      const a = await auth(aliceKey, ACTIONS.REGISTER, node, alice.account.address, guardianHash(aliceKey));
      await viem.assertions.revertWithCustomError(
        qns.write.register(["stale", 1n, a.pubkey, a.signature, a.deadline, SECRET], {
          value: parseEther("1"),
          account: alice.account,
        }),
        qns,
        "CommitmentTooOld",
      );
      const c = await qns.read.makeCommitment(["fresh", alice.account.address, guardianHash(aliceKey), SECRET]);
      await qns.write.commit([c], { account: alice.account });
      await viem.assertions.revertWithCustomError(qns.write.commit([c], { account: alice.account }), qns, "UnexpiredCommitment");
    });
  });

  describe("post-quantum guarded actions", () => {
    it("setAddr works with the guardian's ML-DSA-87 signature", async () => {
      const { qns, auth, register } = await deploy();
      const node = await register("payme");
      const target = bob.account.address;
      const a = await auth(aliceKey, ACTIONS.SET_ADDR, node, alice.account.address, enc([{ type: "address" }], [target]));
      await viem.assertions.emitWithArgs(
        qns.write.setAddr([node, target, a.pubkey, a.signature, a.deadline], { account: alice.account }),
        qns,
        "AddrChanged",
        [node, target],
      );
      assert.equal((await qns.read.resolve(["payme"])).toLowerCase(), target.toLowerCase());
    });

    it("Q-Day scenario: the owner's classical key alone cannot redirect the name", async () => {
      // The attacker controls Alice's ECDSA key (they can send txs as Alice)
      // but not her guardian. Any ML-DSA signature they can make fails.
      const { qns, auth, register } = await deploy();
      const node = await register("victim");
      const attackerPayload = enc([{ type: "address" }], [mallory.account.address]);

      // 1. Their own ML-DSA key: wrong guardian.
      const m = await auth(malloryKey, ACTIONS.SET_ADDR, node, alice.account.address, attackerPayload);
      await viem.assertions.revertWithCustomError(
        qns.write.setAddr([node, mallory.account.address, m.pubkey, m.signature, m.deadline], { account: alice.account }),
        qns,
        "WrongGuardian",
      );
      // 2. Alice's public key with a forged signature of the right length.
      const deadline = m.deadline;
      const forged = toHex(new Uint8Array(4627).fill(7));
      await viem.assertions.revertWithCustomError(
        qns.write.setAddr([node, mallory.account.address, toHex(aliceKey.publicKey), forged, deadline], {
          account: alice.account,
        }),
        qns,
        "PqcSignatureInvalid",
      );
      assert.equal((await qns.read.resolve(["victim"])).toLowerCase(), alice.account.address.toLowerCase());
    });

    it("a signature for one address cannot be reused for another", async () => {
      const { qns, auth, register } = await deploy();
      const node = await register("bound");
      const a = await auth(aliceKey, ACTIONS.SET_ADDR, node, alice.account.address, enc([{ type: "address" }], [bob.account.address]));
      await viem.assertions.revertWithCustomError(
        qns.write.setAddr([node, mallory.account.address, a.pubkey, a.signature, a.deadline], { account: alice.account }),
        qns,
        "PqcSignatureInvalid",
      );
    });

    it("a used signature cannot be replayed (per-name nonce)", async () => {
      const { qns, auth, register } = await deploy();
      const node = await register("replay");
      const a = await auth(aliceKey, ACTIONS.SET_ADDR, node, alice.account.address, enc([{ type: "address" }], [bob.account.address]));
      await qns.write.setAddr([node, bob.account.address, a.pubkey, a.signature, a.deadline], { account: alice.account });
      await viem.assertions.revertWithCustomError(
        qns.write.setAddr([node, bob.account.address, a.pubkey, a.signature, a.deadline], { account: alice.account }),
        qns,
        "PqcSignatureInvalid",
      );
    });

    it("a valid guardian signature is useless without the owner's account (hybrid)", async () => {
      const { qns, auth, register } = await deploy();
      const node = await register("hybrid");
      const a = await auth(aliceKey, ACTIONS.SET_ADDR, node, alice.account.address, enc([{ type: "address" }], [bob.account.address]));
      await viem.assertions.revertWithCustomError(
        qns.write.setAddr([node, bob.account.address, a.pubkey, a.signature, a.deadline], { account: bob.account }),
        qns,
        "NotOwner",
      );
    });

    it("enforces deadlines", async () => {
      const { qns, auth, register, now } = await deploy();
      const node = await register("late");
      const a = await auth(aliceKey, ACTIONS.SET_ADDR, node, alice.account.address, enc([{ type: "address" }], [bob.account.address]));
      await networkHelpers.time.increase(601);
      await viem.assertions.revertWithCustomError(
        qns.write.setAddr([node, bob.account.address, a.pubkey, a.signature, a.deadline], { account: alice.account }),
        qns,
        "DeadlinePassed",
      );
      await viem.assertions.revertWithCustomError(
        qns.write.setAddr([node, bob.account.address, a.pubkey, a.signature, (await now()) + 7200n], {
          account: alice.account,
        }),
        qns,
        "DeadlineTooFar",
      );
    });

    it("transfers to a new owner with their own guardian", async () => {
      const { qns, auth, register } = await deploy();
      const node = await register("gift");
      const payload = enc([{ type: "address" }, { type: "bytes32" }], [bob.account.address, guardianHash(bobKey)]);
      const a = await auth(aliceKey, ACTIONS.TRANSFER, node, alice.account.address, payload);
      await qns.write.transfer([node, bob.account.address, guardianHash(bobKey), a.pubkey, a.signature, a.deadline], {
        account: alice.account,
      });
      const r = await qns.read.recordOf([node]);
      assert.equal(r.owner.toLowerCase(), bob.account.address.toLowerCase());
      assert.equal(r.guardian, guardianHash(bobKey));
      assert.equal(await qns.read.nameOf([alice.account.address]), "");

      // Old guardian is now powerless; Bob's works.
      const old = await auth(aliceKey, ACTIONS.SET_ADDR, node, bob.account.address, enc([{ type: "address" }], [alice.account.address]));
      await viem.assertions.revertWithCustomError(
        qns.write.setAddr([node, alice.account.address, old.pubkey, old.signature, old.deadline], { account: bob.account }),
        qns,
        "WrongGuardian",
      );
      const b = await auth(bobKey, ACTIONS.SET_ADDR, node, bob.account.address, enc([{ type: "address" }], [mallory.account.address]));
      await qns.write.setAddr([node, mallory.account.address, b.pubkey, b.signature, b.deadline], { account: bob.account });
    });

    it("rotates the guardian (old key authorises, new key proves possession)", async () => {
      const { qns, auth, register, pqSign } = await deploy();
      const node = await register("rotate");
      const newHash = guardianHash(bobKey);
      const nonce = (await qns.read.recordOf([node])).nonce;
      const a = await auth(aliceKey, ACTIONS.ROTATE_GUARDIAN, node, alice.account.address, newHash);
      const popMsg = await qns.read.authMessage([ACTIONS.ROTATE_POSSESSION, node, alice.account.address, nonce, a.deadline, newHash]);
      const pop = await pqSign(bobKey, popMsg);
      await qns.write.rotateGuardian([node, pop.pubkey, pop.signature, a.pubkey, a.signature, a.deadline], {
        account: alice.account,
      });
      assert.equal((await qns.read.recordOf([node])).guardian, newHash);
    });

    it("fails closed when the pqcVerify precompile is not active", async () => {
      const { qns, auth, register } = await deploy();
      const node = await register("closed");
      const a = await auth(aliceKey, ACTIONS.SET_ADDR, node, alice.account.address, enc([{ type: "address" }], [bob.account.address]));
      await networkHelpers.setCode(PQC_VERIFY, "0x"); // inactive precompile: empty return data
      await viem.assertions.revertWithCustomError(
        qns.write.setAddr([node, bob.account.address, a.pubkey, a.signature, a.deadline], { account: alice.account }),
        qns,
        "PqcSignatureInvalid",
      );
    });
  });

  describe("records, expiry and admin", () => {
    it("text records and primary name stay classical (cheap)", async () => {
      const { qns, register } = await deploy();
      const node = await register("texts");
      await qns.write.setText([node, "com.x", "@DevBelo_"], { account: alice.account });
      assert.equal(await qns.read.text([node, "com.x"]), "@DevBelo_");
      await viem.assertions.revertWithCustomError(
        qns.write.setText([node, "com.x", "spam"], { account: bob.account }),
        qns,
        "NotOwner",
      );
    });

    it("expires, has a grace period, then can be taken with fresh records", async () => {
      const { qns, register } = await deploy();
      const node = await register("expiry");
      await qns.write.setText([node, "url", "https://old"], { account: alice.account });
      await networkHelpers.time.increase(Number(YEAR) + 1);
      assert.equal(await qns.read.resolve(["expiry"]), "0x0000000000000000000000000000000000000000");
      assert.equal(await qns.read.available(["expiry"]), false); // grace period
      await qns.write.renew(["expiry", 1n], { value: parseEther("1"), account: bob.account }); // anyone can renew
      assert.equal(await qns.read.available(["expiry"]), false);
      await networkHelpers.time.increase(Number(YEAR) + 29 * 24 * 3600);
      assert.equal(await qns.read.available(["expiry"]), true);
      await register("expiry", bob, bobKey);
      assert.equal(await qns.read.text([node, "url"]), "");
      assert.equal((await qns.read.recordOf([node])).owner.toLowerCase(), bob.account.address.toLowerCase());
    });

    it("admin withdraw and price changes need the admin guardian", async () => {
      const { qns, auth, register } = await deploy();
      await register("fees1");
      await register("fees2");
      const amount = parseEther("2");
      const payload = enc([{ type: "address" }, { type: "uint256" }], [deployer.account.address, amount]);

      const bad = await auth(aliceKey, ACTIONS.ADMIN_WITHDRAW, zeroHash, deployer.account.address, payload);
      await viem.assertions.revertWithCustomError(
        qns.write.withdraw([deployer.account.address, amount, bad.pubkey, bad.signature, bad.deadline]),
        qns,
        "WrongGuardian",
      );
      const a = await auth(adminKey, ACTIONS.ADMIN_WITHDRAW, zeroHash, deployer.account.address, payload);
      await viem.assertions.revertWithCustomError(
        qns.write.withdraw([deployer.account.address, amount, a.pubkey, a.signature, a.deadline], { account: alice.account }),
        qns,
        "NotOwner",
      );
      await viem.assertions.emitWithArgs(
        qns.write.withdraw([deployer.account.address, amount, a.pubkey, a.signature, a.deadline]),
        qns,
        "Withdrawn",
        [deployer.account.address, amount],
      );

      const prices = [1n, 2n, 3n] as const;
      const p = await auth(adminKey, ACTIONS.ADMIN_SET_PRICES, zeroHash, deployer.account.address, enc([{ type: "uint256[3]" }], [prices]));
      await qns.write.setPrices([[...prices], p.pubkey, p.signature, p.deadline]);
      assert.equal(await qns.read.rentPrice(["abcdef", 1n]), 3n);
    });

    it("a used admin signature cannot be replayed, for the same or another action", async () => {
      const { qns, auth, register } = await deploy();
      await register("fees3");
      const amount = parseEther("1");
      const payload = enc([{ type: "address" }, { type: "uint256" }], [deployer.account.address, amount]);
      const a = await auth(adminKey, ACTIONS.ADMIN_WITHDRAW, zeroHash, deployer.account.address, payload);
      await qns.write.withdraw([deployer.account.address, amount, a.pubkey, a.signature, a.deadline]);
      await viem.assertions.revertWithCustomError(
        qns.write.withdraw([deployer.account.address, amount, a.pubkey, a.signature, a.deadline]),
        qns,
        "PqcSignatureInvalid",
      );
      await viem.assertions.revertWithCustomError(
        qns.write.setPrices([[1n, 1n, 1n], a.pubkey, a.signature, a.deadline]),
        qns,
        "PqcSignatureInvalid",
      );
    });

    it("reports the gas of a post-quantum guarded action", async () => {
      const { qns, auth, register } = await deploy();
      const node = await register("gasgas");
      const a = await auth(aliceKey, ACTIONS.SET_ADDR, node, alice.account.address, enc([{ type: "address" }], [bob.account.address]));
      const hash = await qns.write.setAddr([node, bob.account.address, a.pubkey, a.signature, a.deadline], {
        account: alice.account,
      });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      // Simulated network: excludes the precompile's own ~85-90k gas on QoreChain.
      console.log(`    setAddr gas (local, without precompile cost): ${receipt.gasUsed}`);
      assert.ok(receipt.gasUsed > 0n);
    });
  });
});
