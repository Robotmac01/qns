import { EXPLORER, short } from "./lib.js";
import type { TxState } from "./useQns.js";

export function TxStatus({ state }: { state: TxState }) {
  if (state.error) return <p className="err" role="alert">{state.error}</p>;
  if (state.busy && state.hash)
    return (
      <p className="pending">
        Confirming <a href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer">{short(state.hash, 6)}</a>
      </p>
    );
  if (state.busy) return <p className="pending">Signing with ML-DSA-87, then confirm in your wallet</p>;
  if (state.done && state.hash)
    return (
      <p className="ok">
        {state.done}. <a href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer">View transaction</a>
      </p>
    );
  return null;
}
