import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys QNS. Parameters come from ignition/parameters.json, written by
 * `pnpm qns init` (the admin guardian hash is derived from QNS_ADMIN_GUARDIAN_CODE).
 *
 * On QoreChain the deployer needs a registered ML-DSA-87 key and a live EVM
 * authorisation window first: `pnpm window register` (once), then `pnpm window open`.
 */
export default buildModule("QNSModule", (m) => {
  const adminGuardian = m.getParameter<string>("adminGuardian");
  // Price per year in wei (QOR has 18 decimals on the EVM lane) for 3, 4, 5+ characters.
  const prices = m.getParameter("prices", [
    20_000_000_000_000_000_000n,
    5_000_000_000_000_000_000n,
    1_000_000_000_000_000_000n,
  ]);
  const qns = m.contract("QNS", [adminGuardian, prices]);
  return { qns };
});
