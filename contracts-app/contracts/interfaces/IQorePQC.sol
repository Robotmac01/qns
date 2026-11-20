// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice QoreChain post-quantum precompiles, as published in the QoreChain
///         docs (developer-guide/evm-precompiles). pqcVerify lives at 0x0a01 and
///         pqcKeyStatus at 0x0a02; both are active on the testnet (qorechain-diana).
interface IQorePQC {
    /// @return valid True when `signature` is a valid ML-DSA-87 signature by
    ///         `pubkey` (2,592 bytes) over `message`. Signature is 4,627 bytes.
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// @return registered       the account has a PQC key on chain
    /// @return algorithmId      1 = ML-DSA-87
    /// @return pubkey           the registered public key
    /// @return possessionProven the key was registered with a verified proof of possession
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}
