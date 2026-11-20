import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { formatEther, type Hex } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { QNS_ABI } from "./abi.js";
import { ACTIONS, type Guardian } from "./guardian.js";
import { Shield } from "./icons.js";
import { QNS, short } from "./lib.js";
import { useQns } from "./useQns.js";
import { TxStatus } from "./TxStatus.js";

type Props = { label: string; guardian: Guardian | null; askGuardian: () => void; onDone: () => void };

export function Register({ label, guardian, askGuardian, onDone }: Props) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [years, setYears] = useState(1);
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

  const register = () =>
    qns.run("register", `${label}.qore is yours`, async () => {
      const node = await qns.read<Hex>("nodeOf", [label]);
      const a = await qns.authorise(ACTIONS.REGISTER, node, address!, 0n, guardian!.hash);
      await qns.send("register", [label, BigInt(years), a.pubkey, a.signature, a.deadline], cost);
    });

  if (qns.state.done) {
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
        <div className="stepper" role="group" aria-label="Registration length">
          <button className="step-btn" aria-label="One year less" disabled={years <= 1} onClick={() => setYears(years - 1)}>−</button>
          <div className="step-value">{years} {years === 1 ? "year" : "years"}</div>
          <button className="step-btn" aria-label="One year more" disabled={years >= 10} onClick={() => setYears(years + 1)}>+</button>
        </div>

        <dl className="bill">
          <div><dt>{years} {years === 1 ? "year" : "years"} registration</dt><dd>{qor(cost)}</dd></div>
          <div className="total"><dt>Total</dt><dd>{qor(cost)}</dd></div>
        </dl>

        <button className={`guard-row ${guardian ? "set" : ""}`} onClick={askGuardian}>
          <Shield size={18} />
          <span className="guard-text">
            <b>Guardian key</b>
            <span>{guardian ? short(guardian.hash, 6) : "Required to protect this name"}</span>
          </span>
          <span className="guard-cta">{guardian ? "Change" : "Set up"}</span>
        </button>

        {!isConnected ? (
          <button className="btn primary block" onClick={openConnectModal}>Connect wallet</button>
        ) : !guardian ? (
          <button className="btn primary block" onClick={askGuardian}>Set up guardian key</button>
        ) : (
          <button className="btn primary block" disabled={!!qns.state.busy || cost === undefined} onClick={register}>
            {qns.state.busy ? "Registering…" : "Register"}
          </button>
        )}
        <TxStatus state={qns.state} />
      </div>
    </div>
  );
}
