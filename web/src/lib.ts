import { classifyEvmWindowRejection, type EvmWindowRejection } from "@qorechain/evm";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

// Default: the live testnet deployment (README). Override with VITE_QNS_ADDRESS.
export const QNS = (import.meta.env.VITE_QNS_ADDRESS || "0x6f23Dc0Ab6CB9dbE24dcf068b3ae424d8Be19c3E") as Address;
export const REST = `${location.origin}/lcd`; // proxied to https://api-testnet.qore.host (Vite in dev, vercel.json in production)
export const EXPLORER = "https://explore.qore.network";
export const ZERO = "0x0000000000000000000000000000000000000000";

export type Rec = { owner: Address; expires: bigint; addr: Address; nonce: bigint; guardian: Hex; version: bigint };

export const TEXT_KEYS = [
  { key: "description", label: "Bio" },
  { key: "url", label: "Website" },
  { key: "com.x", label: "X" },
  { key: "com.github", label: "GitHub" },
  { key: "email", label: "Email" },
] as const;

export const short = (a: string, n = 4) => `${a.slice(0, n + 2)}…${a.slice(-n)}`;
export const clean = (s: string) => s.toLowerCase().trim().replace(/\.qore$/, "");
export const validLabel = (l: string) => /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(l);
export const hashOf = (types: { type: string }[], values: unknown[]) => keccak256(encodeAbiParameters(types, values));
export const fmtDate = (s: bigint) =>
  new Date(Number(s) * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Two hues from the name's hash, for the generated avatar and banner. */
export function hues(seed: string): [number, number] {
  const h = keccak256(new TextEncoder().encode(seed));
  return [200 + (parseInt(h.slice(2, 6), 16) % 50), 180 + (parseInt(h.slice(6, 10), 16) % 90)];
}

const REMEDY: Record<EvmWindowRejection, string> = {
  "no-pqc-key": "Your account has no post-quantum key yet. Make one native send in QoreX first.",
  "no-window": "Open an EVM window in QoreX, then try again.",
  exhausted: "Your EVM window is used up. Open a new one in QoreX.",
  invalid: "The chain refused the EVM window settings.",
};

const KNOWN: Record<string, string> = {
  WrongGuardian: "This guardian key doesn't guard this name.",
  PqcSignatureInvalid: "The post-quantum signature was rejected.",
  NotOwner: "Only the owner can do this.",
  NotAvailable: "This name was just taken.",
  InvalidLabel: "Use 3–63 characters: a–z, 0–9 and hyphens.",
  DeadlinePassed: "The signature expired. Try again.",
  InsufficientPayment: "Not enough QOR for this duration.",
  AccountKeyMissing: "Your account has no proven post-quantum key yet.",
  "User rejected": "You cancelled the request.",
};

export function friendlyError(err: unknown): string {
  const rejection = classifyEvmWindowRejection(err);
  if (rejection) return REMEDY[rejection];
  const m = err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : String(err);
  for (const [k, v] of Object.entries(KNOWN)) if (m.includes(k)) return v;
  return m.split("\n")[0];
}
