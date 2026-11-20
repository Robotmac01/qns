/**
 * guardian.ts - the ML-DSA-87 "guardian" key that protects a .qore name.
 *
 * The guardian key is derived (never stored) from a QRC1 recovery code, the
 * same format QoreChain uses for post-quantum keys. One code always gives the
 * same key. Keep the code apart from your EVM private key: a thief who only has
 * the private key cannot move the name.
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
import { keccak256, toHex, type Hex } from "viem";

export const ACTIONS = {
  REGISTER: 1,
  SET_ADDR: 2,
  TRANSFER: 3,
  ROTATE_GUARDIAN: 4,
  ROTATE_POSSESSION: 5,
  ADMIN_WITHDRAW: 10,
  ADMIN_SET_PRICES: 11,
  ADMIN_TRANSFER: 12,
} as const;

/** Domain-separated seed so a QNS guardian never equals the account's own key. */
export function guardianFromCode(code: string): PqcKeypair {
  if (!isValidRecoveryCode(code)) throw new Error("not a valid QRC1 recovery code");
  const seed = sha256(utf8ToBytes(`QNS guardian v1:${normalizeRecoveryCode(code)}`));
  try {
    return generatePqcKeypair(seed);
  } finally {
    seed.fill(0);
  }
}

export function newGuardianCode(): string {
  return generatePqcRecoveryCode();
}

export function guardianHash(kp: Pick<PqcKeypair, "publicKey">): Hex {
  return keccak256(kp.publicKey);
}

/**
 * Sign the exact message bytes the contract will rebuild (from its
 * `authMessage` view), and check the signature locally before it goes on chain.
 */
export function signAuth(kp: PqcKeypair, message: Hex): { pubkey: Hex; signature: Hex } {
  const msg = hexToU8(message);
  const sig = pqcSign(kp.secretKey, msg);
  if (!pqcVerify(kp.publicKey, msg, sig)) throw new Error("local ML-DSA-87 self-check failed");
  return { pubkey: toHex(kp.publicKey), signature: toHex(sig) };
}

export function hexToU8(h: Hex): Uint8Array {
  return Uint8Array.from(Buffer.from(h.slice(2), "hex"));
}
