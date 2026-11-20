/**
 * Browser copy of contracts-app/scripts/lib/guardian.ts: the same code gives the
 * same ML-DSA-87 key in the CLI and here. The key lives only in memory while
 * the tab is open; the code is never stored or sent anywhere.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
  generatePqcKeypair,
  generatePqcRecoveryCode,
  isValidRecoveryCode,
  normalizeRecoveryCode,
  pqcSign,
  pqcVerify,
  type PqcKeypair,
} from "@qorechain/sdk";
import { bytesToHex, hexToBytes, keccak256, type Hex } from "viem";

export const ACTIONS = { REGISTER: 1, SET_ADDR: 2, TRANSFER: 3 } as const;

export type Guardian = PqcKeypair & { hash: Hex };

export function guardianFromCode(code: string): Guardian {
  if (!isValidRecoveryCode(code)) throw new Error("That is not a valid QRC1 code (check for a typo).");
  const seed = sha256(utf8ToBytes(`QNS guardian v1:${normalizeRecoveryCode(code)}`));
  try {
    const kp = generatePqcKeypair(seed);
    return { ...kp, hash: keccak256(kp.publicKey) };
  } finally {
    seed.fill(0);
  }
}

export const newGuardianCode = () => generatePqcRecoveryCode();

export function signAuth(g: Guardian, message: Hex): { pubkey: Hex; signature: Hex } {
  const msg = hexToBytes(message);
  const sig = pqcSign(g.secretKey, msg);
  if (!pqcVerify(g.publicKey, msg, sig)) throw new Error("Local ML-DSA-87 self-check failed.");
  return { pubkey: bytesToHex(g.publicKey), signature: bytesToHex(sig) };
}
