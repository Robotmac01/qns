import { useState } from "react";
import type { Hex } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

import { QNS_ABI } from "./abi.js";
import { signAuth, type Guardian } from "./guardian.js";
import { QNS, friendlyError } from "./lib.js";

export type TxState = { busy: string; error: string; hash?: Hex; done: string };

/** Sends QNS transactions and, for guarded actions, signs with the guardian key first. */
export function useQns(guardian: Guardian | null) {
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<TxState>({ busy: "", error: "", done: "" });

  const read = <T,>(functionName: string, args: unknown[]) =>
    client!.readContract({ address: QNS!, abi: QNS_ABI, functionName, args } as never) as Promise<T>;

  async function authorise(action: number, node: Hex, owner: Hex, nonce: bigint, payloadHash: Hex) {
    if (!guardian) throw new Error("Unlock your guardian key first.");
    const deadline = (await client!.getBlock()).timestamp + 600n;
    const msg = await read<Hex>("authMessage", [action, node, owner, nonce, deadline, payloadHash]);
    await new Promise((r) => setTimeout(r, 10)); // let the UI paint before signing
    return { ...signAuth(guardian, msg), deadline };
  }

  async function send(functionName: string, args: unknown[], value?: bigint) {
    const hash = await writeContractAsync({
      address: QNS!,
      abi: QNS_ABI,
      functionName,
      args,
      value,
      gas: 1_500_000n, // guarded calls carry ~7 KB of post-quantum key and signature
    } as never);
    setState((s) => ({ ...s, hash }));
    const receipt = await client!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction failed on chain.");
    return hash;
  }

  async function run(key: string, doneText: string, fn: () => Promise<void>) {
    setState({ busy: key, error: "", done: "" });
    try {
      if (!QNS || !client) throw new Error("QNS isn't configured for this network.");
      await fn();
      setState((s) => ({ ...s, busy: "", done: doneText }));
      return true;
    } catch (e) {
      setState((s) => ({ ...s, busy: "", error: friendlyError(e) }));
      return false;
    }
  }

  const clear = () => setState({ busy: "", error: "", done: "" });

  return { state, read, authorise, send, run, clear };
}
