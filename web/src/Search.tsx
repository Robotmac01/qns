import { useState } from "react";
import { useReadContract } from "wagmi";

import { QNS_ABI } from "./abi.js";
import { Search as SearchIcon } from "./icons.js";
import { QNS, clean, hues, validLabel } from "./lib.js";

export const zorb = (seed: string) => {
  const [a, b] = hues(seed);
  return { background: `radial-gradient(75% 75% at 30% 25%, hsl(${b} 95% 78%), hsl(${a} 90% 55%) 60%, hsl(${(a + 40) % 360} 85% 45%))` };
};

export function SearchBox({ go, compact = false }: { go: (label: string) => void; compact?: boolean }) {
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const label = clean(q);
  const ok = validLabel(label);
  const available = useReadContract({
    address: QNS,
    abi: QNS_ABI,
    functionName: "available",
    args: [label],
    query: { enabled: !!QNS && ok },
  });

  const submit = () => { if (ok) { go(label); setQ(""); } };
  const status = !ok ? "invalid" : available.data === undefined ? "loading" : available.data ? "available" : "registered";

  return (
    <div className={`search ${compact ? "compact" : ""}`}>
      <div className="search-field">
        <SearchIcon size={compact ? 18 : 22} />
        <input
          value={q}
          placeholder="Search for a name"
          aria-label="Search for a name"
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
        />
      </div>
      {focus && label && (
        <div className="dropdown">
          <button className="drop-row" disabled={!ok} onMouseDown={submit}>
            <span className="zorb sm" style={zorb(label)} />
            <span className="drop-name">{label}<span className="tld">.qore</span></span>
            {status === "invalid" && <span className="tag gray">Invalid</span>}
            {status === "loading" && <span className="tag gray">…</span>}
            {status === "available" && <span className="tag green">Available</span>}
            {status === "registered" && <span className="tag blue">Registered</span>}
          </button>
          {!ok && label.length > 0 && <p className="drop-hint">3–63 characters: a–z, 0–9 and hyphens</p>}
        </div>
      )}
    </div>
  );
}
