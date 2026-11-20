import { useEffect, useState } from "react";

import { guardianFromCode, newGuardianCode, type Guardian } from "./guardian.js";
import { Copy, Shield } from "./icons.js";

type Props = { open: boolean; guardian: Guardian | null; onClose: () => void; onReady: (g: Guardian | null) => void };

export function GuardianModal({ open, guardian, onClose, onReady }: Props) {
  const [mode, setMode] = useState<"paste" | "create">("paste");
  const [code, setCode] = useState("");
  const [fresh, setFresh] = useState("");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(""); setErr(""); setSaved(false); setMode("paste");
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  if (!open) return null;

  const load = (c: string) => {
    setErr("");
    setBusy(true);
    setTimeout(() => {
      try {
        onReady(guardianFromCode(c));
        onClose();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }, 20);
  };

  if (guardian && mode === "paste" && !code) {
    return (
      <div className="scrim" onMouseDown={onClose}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="gk-title" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-icon ok"><Shield size={26} /></div>
          <h2 id="gk-title">Guardian unlocked</h2>
          <p className="sub">Share your guardian ID with anyone sending you a name.</p>
          <div className="code-box">
            <span>{guardian.hash}</span>
            <button className="icon-btn" aria-label="Copy guardian ID" onClick={() => navigator.clipboard?.writeText(guardian.hash)}>
              <Copy />
            </button>
          </div>
          <button className="btn primary block" onClick={onClose}>Done</button>
          <button className="btn text block" onClick={() => { onReady(null); onClose(); }}>Lock</button>
        </div>
      </div>
    );
  }

  const create = () => { setFresh(newGuardianCode()); setSaved(false); setMode("create"); };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="gk-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-icon"><Shield size={26} /></div>
        <h2 id="gk-title">Guardian key</h2>
        <p className="sub">
          A second key, separate from your wallet, that signs transfers and address changes.
        </p>

        {mode === "paste" ? (
          <>
            <textarea
              className="code-input"
              placeholder="QRC1-XXXX-XXXX-…"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={3}
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
            {err && <p className="err">{err}</p>}
            <button className="btn primary block" disabled={!code || busy} onClick={() => load(code)}>
              {busy ? "Unlocking…" : "Unlock"}
            </button>
            <button className="btn text block" onClick={create}>I don't have one, create a key</button>
          </>
        ) : (
          <>
            <div className="code-box">
              <span>{fresh}</span>
              <button className="icon-btn" aria-label="Copy code" onClick={() => navigator.clipboard?.writeText(fresh)}>
                <Copy />
              </button>
            </div>
            <p className="note">Write it down. It isn't saved anywhere and can't be recovered.</p>
            <label className="check">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              I've saved this code
            </label>
            <button className="btn primary block" disabled={!saved || busy} onClick={() => load(fresh)}>
              {busy ? "Unlocking…" : "Use this key"}
            </button>
            <button className="btn text block" onClick={() => setMode("paste")}>Back</button>
          </>
        )}
      </div>
    </div>
  );
}
