import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { defineChain } from "viem";
import { qorexWallet } from "@qorechain/qorex-rainbowkit";
import { createConfig, http } from "wagmi";

// Chain definitions match the published QoreChain EVM endpoints (chain ids 9800 / 9801).
// Defined here so they use this app's own viem version.
const native = { name: "QOR", symbol: "QOR", decimals: 18 } as const;
const explorer = { default: { name: "QoreChain Explorer", url: "https://explore.qore.network" } } as const;
export const qorechainTestnet = defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency: native,
  rpcUrls: { default: { http: ["https://evm-testnet.qore.host"] } },
  blockExplorers: explorer,
  testnet: true,
});
export const qorechain = defineChain({
  id: 9801,
  name: "QoreChain",
  nativeCurrency: native,
  rpcUrls: { default: { http: ["https://evm.qore.host"] } },
  blockExplorers: explorer,
});

// QoreX first, then any other injected (EIP-1193) wallet. Neither uses
// WalletConnect, so the project id is only a placeholder unless you add a
// WalletConnect-based wallet.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [() => qorexWallet({ pollAccountsOnFocus: true }), injectedWallet],
    },
  ],
  {
    appName: "QNS - Qore Name Service",
    projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "unused",
  },
);

// The testnet is listed first, so a fresh connection lands there.
export const config = createConfig({
  chains: [qorechainTestnet, qorechain],
  connectors,
  transports: {
    [qorechainTestnet.id]: http(),
    [qorechain.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
