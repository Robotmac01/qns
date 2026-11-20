import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Load .env (PRIVATE_KEY) when present. Hardhat resolves configuration
// variables from the environment or from `npx hardhat keystore set PRIVATE_KEY`.
try {
  process.loadEnvFile();
} catch {
  // No .env: rely on the environment or the keystore.
}

// Optional: SOLC_PATH points Hardhat at a local solc (native or soljson.js)
// when the compiler download is blocked. Leave unset normally.
const solcPath = process.env.SOLC_PATH ? { path: process.env.SOLC_PATH } : {};
const compiler = {
  version: "0.8.28",
  ...solcPath,
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
};

// Public QoreChain EVM endpoints.
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: { default: compiler, production: compiler },
  },
  networks: {
    hardhatMainnet: { type: "edr-simulated", chainType: "l1" },
    qorechainTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 9800,
      url: "https://evm-testnet.qore.host",
      accounts: [configVariable("PRIVATE_KEY")],
    },
    qorechain: {
      type: "http",
      chainType: "l1",
      chainId: 9801,
      url: "https://evm.qore.host",
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
});
