/**
 * qns.ts - command line for QNS on the QoreChain testnet.
 *
 *   pnpm qns guardian-code               print a new guardian code (QRC1-...)
 *   pnpm qns guardian-hash               the hash of your guardian key (give it to whoever transfers you a name)
 *   pnpm qns init                        write ignition/parameters.json from QNS_ADMIN_GUARDIAN_CODE
 *   pnpm qns price <label> [years]
 *   pnpm qns register <label> [years] [--account-key]
 *   pnpm qns info <label>                owner, address, expiry, guardian
 *   pnpm qns resolve <label>
 *   pnpm qns whois <0x address>          reverse lookup (primary name)
 *   pnpm qns set-addr <label> <0x>       post-quantum guarded
 *   pnpm qns transfer <label> <0x to> <guardian hash of the new owner>   post-quantum guarded
 *   pnpm qns text <label> <key> <value>
 *   pnpm qns withdraw <0x to> <QOR>      admin, post-quantum guarded
 *
 * Every write needs a live EVM window first: `pnpm window scoped` (or `open`).
 */
import { writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  formatEther,
  http,
  keccak256,
  parseEther,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PqcKeypair } from "@qorechain/sdk";

import { ACTIONS, guardianFromCode, guardianHash, newGuardianCode, signAuth } from "./lib/guardian.js";
import { QNS_ABI } from "./lib/abi.js";

const qorechainTestnet = defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm-testnet.qore.host"] } },
  blockExplorers: { default: { name: "QoreChain Explorer", url: "https://explore.qore.network" } },
});

const env = (k: string): string => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`Set ${k} in .env`);
  return v;
};

const pub = createPublicClient({ chain: qorechainTestnet, transport: http() });
const qnsAddress = () => env("QNS_ADDRESS") as Address;
const wallet = () =>
  createWalletClient({ chain: qorechainTestnet, transport: http(), account: privateKeyToAccount(env("PRIVATE_KEY") as Hex) });

const read = <T>(functionName: string, args: unknown[] = []) =>
  pub.readContract({ address: qnsAddress(), abi: QNS_ABI, functionName, args } as never) as Promise<T>;

async function write(functionName: string, args: unknown[], value?: bigint): Promise<void> {
  const w = wallet();
  const { request } = await pub.simulateContract({
    address: qnsAddress(),
    abi: QNS_ABI,
    functionName,
    args,
    value,
    account: w.account,
  } as never);
  const hash = await w.writeContract(request as never);
  console.log(`tx: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`status: ${receipt.status}, gas used: ${receipt.gasUsed}`);
  console.log(`explorer: https://explore.qore.network/tx/${hash}`);
}

type Rec = { owner: Address; expires: bigint; addr: Address; nonce: bigint; guardian: Hex; version: bigint };
const nodeOf = (label: string) => read<Hex>("nodeOf", [label]);
const deadline = async () => (await pub.getBlock()).timestamp + 600n;
const hashOf = (types: { type: string }[], values: unknown[]) => keccak256(encodeAbiParameters(types, values));

/** Build the message from the contract itself, sign it with ML-DSA-87, check it locally. */
async function authorise(kp: PqcKeypair, action: number, node: Hex, owner: Address, nonce: bigint, payloadHash: Hex) {
  const dl = await deadline();
  const msg = await read<Hex>("authMessage", [action, node, owner, nonce, dl, payloadHash]);
  return { ...signAuth(kp, msg), deadline: dl };
}

const guardian = () => guardianFromCode(env("QNS_GUARDIAN_CODE"));

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async "guardian-code"() {
    console.log(newGuardianCode());
    console.log("Put it in .env as QNS_GUARDIAN_CODE and write it on paper. It cannot be rebuilt.");
  },

  async "guardian-hash"() {
    console.log(guardianHash(guardian()));
  },

  async init() {
    const hash = guardianHash(guardianFromCode(env("QNS_ADMIN_GUARDIAN_CODE")));
    writeFileSync("ignition/parameters.json", JSON.stringify({ QNSModule: { adminGuardian: hash } }, null, 2) + "\n");
    console.log(`ignition/parameters.json written (admin guardian ${hash})`);
  },

  async price([label, years = "1"]) {
    console.log(`${label}.qore for ${years} year(s): ${formatEther(await read<bigint>("rentPrice", [label, BigInt(years)]))} QOR`);
    console.log(`available: ${await read<boolean>("available", [label])}`);
  },

  async register([label, years = "1", flag]) {
    if (!label) throw new Error("usage: register <label> [years] [--account-key]");
    const owner = wallet().account.address;
    const y = BigInt(years);
    const value = await read<bigint>("rentPrice", [label, y]);
    if (flag === "--account-key") {
      // Guardian = the account's own ML-DSA-87 key, read on chain via pqcKeyStatus.
      await write("register", [label, y, "0x", "0x", 0n], value);
    } else {
      const kp = guardian();
      const node = await nodeOf(label);
      const a = await authorise(kp, ACTIONS.REGISTER, node, owner, 0n, guardianHash(kp));
      await write("register", [label, y, a.pubkey, a.signature, a.deadline], value);
    }
    console.log(`registered ${label}.qore`);
  },

  async info([label]) {
    const node = await nodeOf(label);
    const r = await read<Rec>("recordOf", [node]);
    console.log({ name: `${label}.qore`, node, ...r, expiresAt: new Date(Number(r.expires) * 1000).toISOString() });
  },

  async resolve([label]) {
    console.log(await read<Address>("resolve", [label]));
  },

  async whois([address]) {
    console.log((await read<string>("nameOf", [address])) || "(no primary name)");
  },

  async "set-addr"([label, to]) {
    const node = await nodeOf(label);
    const r = await read<Rec>("recordOf", [node]);
    const a = await authorise(guardian(), ACTIONS.SET_ADDR, node, r.owner, r.nonce, hashOf([{ type: "address" }], [to]));
    await write("setAddr", [node, to, a.pubkey, a.signature, a.deadline]);
  },

  async transfer([label, to, newGuardian]) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(newGuardian ?? "")) throw new Error("usage: transfer <label> <0x to> <0x guardian hash>");
    const node = await nodeOf(label);
    const r = await read<Rec>("recordOf", [node]);
    const payload = hashOf([{ type: "address" }, { type: "bytes32" }], [to, newGuardian]);
    const a = await authorise(guardian(), ACTIONS.TRANSFER, node, r.owner, r.nonce, payload);
    await write("transfer", [node, to, newGuardian, a.pubkey, a.signature, a.deadline]);
  },

  async text([label, key, value]) {
    await write("setText", [await nodeOf(label), key, value]);
  },

  async withdraw([to, qor]) {
    const amount = parseEther(qor);
    const kp = guardianFromCode(env("QNS_ADMIN_GUARDIAN_CODE"));
    const nonce = await read<bigint>("adminNonce");
    const admin = await read<Address>("admin");
    const payload = hashOf([{ type: "address" }, { type: "uint256" }], [to, amount]);
    const a = await authorise(kp, ACTIONS.ADMIN_WITHDRAW, zeroHash, admin, nonce, payload);
    await write("withdraw", [to, amount, a.pubkey, a.signature, a.deadline]);
  },
};

const [cmd = "help", ...rest] = process.argv.slice(2);
const run = commands[cmd];
if (!run) {
  console.log(`Commands: ${Object.keys(commands).join(" | ")}`);
  process.exit(cmd === "help" ? 0 : 1);
}
run(rest).catch((err: unknown) => {
  const m = err instanceof Error ? err.message : String(err);
  if (/window|nonce too low|PQC/i.test(m)) console.error("Hint: open an EVM window first with `pnpm window scoped`.");
  console.error(m);
  process.exitCode = 1;
});
