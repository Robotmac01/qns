import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { formatEther, toHex, type Hex } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { QNS_ABI } from "./abi.js";
import { ACTIONS, type Guardian } from "./guardian.js";
import { Shield } from "./icons.js";
import { QNS, short } from "./lib.js";
import { useQns } from "./useQns.js";
import { TxStatus } from "./TxStatus.js";

type Props = { label: string; guardian: Guardian | null; askGuardian: () => void; onDone: () => void };

/** Seconds to wait after committing; the contract enforces 60. */
const WAIT = 65;

export function Register({ label, guardian, askGuardian, onDone }: Props) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [years, setYears] = useState(1);
  const [secret, setSecret] = useState<Hex | null>(null);
  const [left, setLeft] = useState(0);
  const qns = useQns(guardian);
  const price = useReadContract({
    address: QNS,
    abi: QNS_ABI,
    functionName: "rentPrice",
    args: [label, BigInt(years)],
    query: { enabled: !!QNS },
  });
  const cost = price.data as bigint | undefined;
  const qor = (v?: bigint) => (v === undefined ? "–" : `${Number(formatEther(v)).toLocaleString()} QOR`);
  const step = !secret ? 1 : left > 0 ? 2 : 3;

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  // Step 1: commit. Hides which name you want until the wait is over.
  const start = () =>
    qns.run("commit", "Timer started", async () => {
      const s = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const c = await qns.read<Hex>("makeCommitment", [label, address!, guardian!.hash, s]);
      await qns.send("commit", [c]);
      setSecret(s);
      setLeft(WAIT);
    });

  // Step 3: register (reveal), with the guardian's proof of possession.
  const register = () =>
    qns.run("register", `${label}.qore is yours`, async () => {
      const node = await qns.read<Hex>("nodeOf", [label]);
      const a = await qns.authorise(ACTIONS.REGISTER, node, address!, 0n, guardian!.hash);
      await qns.send("register", [label, BigInt(years), a.pubkey, a.signature, a.deadline, secret], cost);
    });

  if (qns.state.done && step === 3 && qns.state.done.endsWith("is yours")) {
    return (
      <div className="narrow">
        <div className="card pad center success">
          <div className="big-check"><Shield size={34} /></div>
          <h1 className="title">{label}.qore</h1>
          <p className="sub">is yours, guarded by your post-quantum key.</p>
          <button className="btn primary" onClick={onDone}>View name</button>
        </div>
      </div>
    );
  }

  return (
    <div className="narrow">
      <h1 className="title">
        {label}<span className="tld">.qore</span>
      </h1>

      <div className="card pad">
        <ol className="steps" aria-label="Registration steps">
          <li className={step >= 1 ? "on" : ""}>Start timer</li>
          <li className={step >= 2 ? "on" : ""}>Wait 1 minute</li>
          <li className={step >= 3 ? "on" : ""}>Register</li>
        </ol>

        <div className="stepper" role="group" aria-label="Registration length">
          <button className="step-btn" aria-label="One year less" disabled={years <= 1 || step > 1} onClick={() => setYears(years - 1)}>−</button>
          <div className="step-value">{years} {years === 1 ? "year" : "years"}</div>
          <button className="step-btn" aria-label="One year more" disabled={years >= 10 || step > 1} onClick={() => setYears(years + 1)}>+</button>
        </div>

        <dl className="bill">
          <div><dt>{years} {years === 1 ? "year" : "years"} registration</dt><dd>{qor(cost)}</dd></div>
          <div className="total"><dt>Total</dt><dd>{qor(cost)}</dd></div>
        </dl>

        <button className={`guard-row ${guardian ? "set" : ""}`} onClick={askGuardian} disabled={step > 1}>
          <Shield size={18} />
          <span className="guard-text">
            <b>Guardian key</b>
            <span>{guardian ? short(guardian.hash, 6) : "Required to protect this name"}</span>
          </span>
          {step === 1 && <span className="guard-cta">{guardian ? "Change" : "Set up"}</span>}
        </button>

        {!isConnected ? (
          <button className="btn primary block" onClick={openConnectModal}>Connect wallet</button>
        ) : !guardian ? (
          <button className="btn primary block" onClick={askGuardian}>Set up guardian key</button>
        ) : step === 1 ? (
          <button className="btn primary block" disabled={!!qns.state.busy || cost === undefined} onClick={start}>
            {qns.state.busy ? "Starting…" : "Start timer"}
          </button>
        ) : step === 2 ? (
          <button className="btn primary block" disabled>
            Wait {left}s
          </button>
        ) : (
          <button className="btn primary block" disabled={!!qns.state.busy} onClick={register}>
            {qns.state.busy ? "Registering…" : "Register"}
          </button>
        )}
        {step === 2 && <p className="hint">The wait stops anyone from taking the name first. Keep this tab open.</p>}
        <TxStatus state={qns.state} />
      </div>
    </div>
  );
}
