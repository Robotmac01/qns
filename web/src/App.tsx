import { ConnectButton } from "@rainbow-me/rainbowkit";
import { evmWindowStatus } from "@qorechain/evm";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { QNS_ABI } from "./abi.js";
import type { Guardian } from "./guardian.js";
import { GuardianModal } from "./GuardianModal.js";
import { Logo, Shield } from "./icons.js";
import { QNS, REST, ZERO, clean, validLabel, type Rec } from "./lib.js";
import { NameView } from "./NameView.js";
import { Register } from "./Register.js";
import { SearchBox } from "./Search.js";

/** Hash routes: "#/" home, "#/okafor.qore" a name. */
function useRoute(): [string, (label: string) => void] {
  const read = () => clean(decodeURIComponent(location.hash.replace(/^#\/?/, "")));
  const [label, setLabel] = useState(read);
  useEffect(() => {
    const on = () => { setLabel(read()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [label, (l: string) => { location.hash = l ? `/${l}.qore` : "/"; }];
}

function WindowDot({ address }: { address: Address }) {
  const { data } = useQuery({
    queryKey: ["evm-window", address],
    queryFn: () => evmWindowStatus({ rest: REST, address }),
    refetchInterval: 8_000,
  });
  if (!data) return null;
  const live = data.found && data.live;
  return (
    <span className={`window ${live ? "live" : ""}`} title={live ? `EVM window open, ${data.remainingTxs} transactions left` : "No EVM window open. QoreX will offer to open one."}>
      <i /> {live ? "Window open" : "No window"}
    </span>
  );
}

export function App() {
  const [label, go] = useRoute();
  const { address, isConnected } = useAccount();
  const [guardian, setGuardian] = useState<Guardian | null>(null);
  const [modal, setModal] = useState(false);
  const askGuardian = useCallback(() => setModal(true), []);
  const closeModal = useCallback(() => setModal(false), []);

  const myName = useReadContract({
    address: QNS, abi: QNS_ABI, functionName: "nameOf", args: address ? [address] : undefined,
    query: { enabled: !!QNS && !!address },
  });

  return (
    <>
      <header className="nav">
        <a className="brand" href="#/" aria-label="QNS home"><Logo /><span>QNS</span></a>
        <div className="nav-right">
          {label && <div className="nav-search"><SearchBox go={go} compact /></div>}
          {isConnected && address && <WindowDot address={address} />}
          <button className={`guard-chip ${guardian ? "on" : ""}`} onClick={askGuardian} aria-label="Guardian key">
            <Shield size={16} /> <span>Guardian</span>
          </button>
          <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />
        </div>
      </header>

      <main>
        {!QNS && <p className="config">Set VITE_QNS_ADDRESS in web/.env to the deployed contract.</p>}
        {label ? (
          validLabel(label) ? (
            <NameRoute key={label} label={label} guardian={guardian} askGuardian={askGuardian} go={go} />
          ) : (
            <div className="narrow"><div className="card pad center"><p className="empty">“{label}” isn't a valid name. Use 3–63 characters: a–z, 0–9 and hyphens.</p></div></div>
          )
        ) : (
          <section className="home">
            <h1 className="hero">Your name on QoreChain</h1>
            <p className="hero-sub">One name for your address and profile, protected by post-quantum signatures.</p>
            <SearchBox go={go} />
            {myName.data && (
              <a className="mine" href={`#/${myName.data}`}>Go to {String(myName.data)}</a>
            )}
          </section>
        )}
      </main>

      <GuardianModal open={modal} guardian={guardian} onClose={closeModal} onReady={setGuardian} />
    </>
  );
}

function NameRoute({ label, guardian, askGuardian, go }: { label: string; guardian: Guardian | null; askGuardian: () => void; go: (l: string) => void }) {
  const node = useReadContract({ address: QNS, abi: QNS_ABI, functionName: "nodeOf", args: [label], query: { enabled: !!QNS } });
  const available = useReadContract({ address: QNS, abi: QNS_ABI, functionName: "available", args: [label], query: { enabled: !!QNS } });
  const record = useReadContract({
    address: QNS, abi: QNS_ABI, functionName: "recordOf", args: node.data ? [node.data as Hex] : undefined,
    query: { enabled: !!node.data, refetchInterval: 8000 },
  });
  const rec = record.data as Rec | undefined;

  if (!QNS) return null;
  if (available.data === undefined || !node.data) return <div className="narrow"><div className="skeleton" /></div>;
  if (available.data) {
    return <Register label={label} guardian={guardian} askGuardian={askGuardian} onDone={() => { available.refetch(); record.refetch(); go(label); }} />;
  }
  if (!rec || rec.owner === ZERO) return <div className="narrow"><div className="skeleton" /></div>;
  return <NameView label={label} node={node.data as Hex} rec={rec} guardian={guardian} askGuardian={askGuardian} refetch={() => record.refetch()} />;
}
