import { useState, type ReactNode } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

import { QNS_ABI } from "./abi.js";
import { ACTIONS, type Guardian } from "./guardian.js";
import { Copy, Lock, Shield } from "./icons.js";
import { QNS, TEXT_KEYS, fmtDate, hashOf, short, type Rec } from "./lib.js";
import { zorb } from "./Search.js";
import { TxStatus } from "./TxStatus.js";
import { useQns } from "./useQns.js";

type Props = { label: string; node: Hex; rec: Rec; guardian: Guardian | null; askGuardian: () => void; refetch: () => void };
type Tab = "profile" | "records" | "ownership";

export function NameView({ label, node, rec, guardian, askGuardian, refetch }: Props) {
  const { address } = useAccount();
  const [tab, setTab] = useState<Tab>("profile");
  const isOwner = !!address && rec.owner.toLowerCase() === address.toLowerCase();
  const unlocked = !!guardian && guardian.hash === rec.guardian;
  const expired = Number(rec.expires) * 1000 < Date.now();

  const texts = useReadContracts({
    contracts: TEXT_KEYS.map((t) => ({ address: QNS!, abi: QNS_ABI, functionName: "text", args: [node, t.key] }) as const),
    query: { enabled: !!QNS, refetchInterval: 8000 },
  });
  const textVal = (i: number) => (texts.data?.[i]?.result as string | undefined) ?? "";
  const primary = useReadContract({
    address: QNS, abi: QNS_ABI, functionName: "nameOf", args: address ? [address] : undefined,
    query: { enabled: !!QNS && !!address },
  });

  const url = textVal(1);
  const isPrimary = primary.data === `${label}.qore`;

  return (
    <div className="wide">
      <nav className="tabs" role="tablist" aria-label={`${label}.qore`}>
        {(["profile", "records", "ownership"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === "profile" && (
        <>
          <section className="card snippet">
            <div className="banner" />
            <div className="snippet-body">
              <div className="snippet-top">
                <div className="zorb xl" style={zorb(label)} />
                {isOwner && <button className="btn soft sm" onClick={() => setTab("records")}>Edit profile</button>}
              </div>
              <div className="snippet-name">
                <h1>{label}.qore</h1>
                <span className="badge" title="Transfers and address changes need an ML-DSA-87 signature"><Shield /> Quantum-safe</span>
              </div>
              {textVal(0) && <p className="bio">{textVal(0)}</p>}
              {url && <a className="url" href={url.startsWith("http") ? url : `https://${url}`} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>}
              {(isPrimary || expired) && (
                <div className="tags">
                  {isPrimary && <span className="tag green">Your primary name</span>}
                  {expired && <span className="tag red">Expired</span>}
                </div>
              )}
            </div>
          </section>

          <section className="card details">
            <Section title="Accounts" show={TEXT_KEYS.some((t, i) => i > 1 && textVal(i))}>
              {TEXT_KEYS.map((t, i) => i > 1 && textVal(i) ? <Chip key={t.key} label={t.label} value={textVal(i)} /> : null)}
            </Section>
            <Section title="Address" show>
              <Chip label="QOR" value={rec.addr} />
            </Section>
            <Section title="Ownership" show>
              <Chip label="owner" value={rec.owner} />
              <Chip label="guardian" value={rec.guardian} />
              <Chip label="expiry" value={fmtDate(rec.expires)} plain />
            </Section>
            {isOwner && !isPrimary && (
              <div className="details-actions">
                <PrimaryButton node={node} guardian={guardian} done={() => primary.refetch()} />
              </div>
            )}
          </section>
        </>
      )}

      {tab === "records" && (
        <Records label={label} node={node} rec={rec} isOwner={isOwner} unlocked={unlocked} guardian={guardian}
          askGuardian={askGuardian} texts={TEXT_KEYS.map((_, i) => textVal(i))} refetch={() => { refetch(); texts.refetch(); }} />
      )}

      {tab === "ownership" && (
        <Ownership node={node} rec={rec} isOwner={isOwner} unlocked={unlocked} guardian={guardian}
          askGuardian={askGuardian} refetch={refetch} />
      )}
    </div>
  );
}

function Section({ title, show, children }: { title: string; show: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <div className="section">
      <h3 className="section-title">{title}</h3>
      <div className="chips">{children}</div>
    </div>
  );
}

function Chip({ label, value, plain }: { label: string; value: string; plain?: boolean }) {
  const [copied, setCopied] = useState(false);
  const shown = /^0x[0-9a-fA-F]{40}$/.test(value) ? short(value, 4) : /^0x[0-9a-fA-F]{64}$/.test(value) ? short(value, 4) : value;
  if (plain) return <span className="chip"><span className="chip-label">{label}</span>{shown}</span>;
  return (
    <button className="chip" title={value} onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
      <span className="chip-label">{label}</span>
      {copied ? "Copied" : shown}
      <Copy size={13} />
    </button>
  );
}

function PrimaryButton({ node, guardian, done }: { node: Hex; guardian: Guardian | null; done: () => void }) {
  const qns = useQns(guardian);
  return (
    <>
      <button className="btn soft" disabled={!!qns.state.busy}
        onClick={async () => { if (await qns.run("primary", "Primary name set", () => qns.send("setPrimaryName", [node]).then(() => {}))) done(); }}>
        {qns.state.busy ? "Setting…" : "Set as primary name"}
      </button>
      <TxStatus state={qns.state} />
    </>
  );
}

type EditProps = {
  node: Hex; rec: Rec; isOwner: boolean; unlocked: boolean; guardian: Guardian | null;
  askGuardian: () => void; refetch: () => void;
};

function GuardedButton({ unlocked, busy, onClick, children, askGuardian, disabled }: {
  unlocked: boolean; busy: boolean; onClick: () => void; children: string; askGuardian: () => void; disabled?: boolean;
}) {
  if (!unlocked)
    return <button className="btn soft" onClick={askGuardian}><Lock /> Unlock to {children.toLowerCase()}</button>;
  return <button className="btn primary" disabled={busy || disabled} onClick={onClick}><Lock /> {busy ? "Signing…" : children}</button>;
}

function Records({ label, node, rec, isOwner, unlocked, guardian, askGuardian, texts, refetch }: EditProps & { label: string; texts: string[] }) {
  const qns = useQns(guardian);
  const [addr, setAddr] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});

  if (!isOwner) {
    return <div className="card pad"><p className="empty">Only the owner of {label}.qore can edit its records.</p></div>;
  }

  const saveAddr = () =>
    qns.run("addr", "Address updated", async () => {
      if (!isAddress(addr)) throw new Error("Enter a valid 0x address.");
      const a = await qns.authorise(ACTIONS.SET_ADDR, node, rec.owner, rec.nonce, hashOf([{ type: "address" }], [addr]));
      await qns.send("setAddr", [node, addr, a.pubkey, a.signature, a.deadline]);
      setAddr("");
      refetch();
    });

  const saveText = (key: string) =>
    qns.run(key, "Record saved", async () => {
      await qns.send("setText", [node, key, vals[key] ?? ""]);
      refetch();
    });

  return (
    <div className="card pad">
      <h3 className="h3">Address <span className="lock-note"><Lock size={12} /> Needs guardian</span></h3>
      <div className="field">
        <input placeholder={rec.addr} value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} />
        <GuardedButton unlocked={unlocked} busy={qns.state.busy === "addr"} onClick={saveAddr} askGuardian={askGuardian} disabled={!addr}>
          Update
        </GuardedButton>
      </div>

      <h3 className="h3">Profile</h3>
      {TEXT_KEYS.map((t, i) => (
        <div className="field" key={t.key}>
          <span className="field-label">{t.label}</span>
          <input
            value={vals[t.key] ?? texts[i]}
            placeholder="Not set"
            onChange={(e) => setVals({ ...vals, [t.key]: e.target.value })}
          />
          {vals[t.key] !== undefined && vals[t.key] !== texts[i] && (
            <button className="btn primary" disabled={!!qns.state.busy} onClick={() => saveText(t.key)}>
              {qns.state.busy === t.key ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      ))}
      <TxStatus state={qns.state} />
    </div>
  );
}

function Ownership({ node, rec, isOwner, unlocked, guardian, askGuardian, refetch }: EditProps) {
  const qns = useQns(guardian);
  const [to, setTo] = useState("");
  const [toGuardian, setToGuardian] = useState("");

  const send = () =>
    qns.run("send", "Name sent", async () => {
      if (!isAddress(to)) throw new Error("Enter the recipient's 0x address.");
      if (!/^0x[0-9a-fA-F]{64}$/.test(toGuardian)) throw new Error("Enter the recipient's guardian ID (0x + 64 characters).");
      const payload = hashOf([{ type: "address" }, { type: "bytes32" }], [to, toGuardian]);
      const a = await qns.authorise(ACTIONS.TRANSFER, node, rec.owner, rec.nonce, payload);
      await qns.send("transfer", [node, to as Address, toGuardian, a.pubkey, a.signature, a.deadline]);
      refetch();
    });

  return (
    <div className="card pad">
      <div className="roles">
        <Role name="Owner" value={short(rec.owner, 6)} />
        <Role name="Guardian ID" value={short(rec.guardian, 6)} hint={unlocked ? "Unlocked" : undefined} />
        <Role name="Expires" value={fmtDate(rec.expires)} />
      </div>

      {isOwner && (
        <>
          <h3 className="h3">Send name <span className="lock-note"><Lock size={12} /> Needs guardian</span></h3>
          <div className="stack">
            <input placeholder="Recipient address (0x…)" value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} />
            <input placeholder="Recipient's guardian ID (0x…)" value={toGuardian} onChange={(e) => setToGuardian(e.target.value)} spellCheck={false} />
            <GuardedButton unlocked={unlocked} busy={qns.state.busy === "send"} onClick={send} askGuardian={askGuardian} disabled={!to || !toGuardian}>
              Send
            </GuardedButton>
          </div>
          <TxStatus state={qns.state} />
        </>
      )}
    </div>
  );
}

function Role({ name, value, hint }: { name: string; value: string; hint?: string }) {
  return (
    <div className="role">
      <span className="role-name">{name}</span>
      <span className="role-value">{value}</span>
      {hint && <span className="tag green">{hint}</span>}
    </div>
  );
}
