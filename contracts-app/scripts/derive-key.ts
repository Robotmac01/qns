/**
 * Prints the EVM private key and 0x address for QORE_MNEMONIC (m/44'/60'/0'/0/0).
 * Check the address matches your QoreX 0x address, then put the key in .env as PRIVATE_KEY.
 * Test wallets only.
 */
import { mnemonicToAccount } from "viem/accounts";
import { toHex } from "viem";

const m = process.env.QORE_MNEMONIC?.trim();
if (!m) throw new Error("Set QORE_MNEMONIC in .env first");
const a = mnemonicToAccount(m);
console.log(`address:     ${a.address}`);
console.log(`PRIVATE_KEY=${toHex(a.getHdKey().privateKey!)}`);
