// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice TEST ONLY. Hardhat's simulated network has no QoreChain precompiles,
///         so the tests place this code at 0x0a01 and 0x0a02.
///
/// It does not do ML-DSA maths itself. The test harness signs with a real
/// ML-DSA-87 key (pqcSign from the QoreChain SDK), verifies the signature with the real
/// verifier (pqcVerify from the QoreChain SDK) and only then records the exact
/// (pubkey, signature, message) triple here. Anything not recorded - a tampered
/// message, a signature from another key, a different action - returns false,
/// just as the chain's precompile would.
contract PqcPrecompileStandIn {
    mapping(bytes32 => bool) public verified;

    struct KeyStatus {
        bool registered;
        uint8 algorithmId;
        bytes pubkey;
        bool possessionProven;
    }

    mapping(address => KeyStatus) private _status;

    function recordVerified(bytes32 tripleHash) external {
        verified[tripleHash] = true;
    }

    function setKeyStatus(address account, bool registered, uint8 algorithmId, bytes calldata pubkey, bool proven)
        external
    {
        _status[account] = KeyStatus(registered, algorithmId, pubkey, proven);
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool)
    {
        return verified[keccak256(abi.encode(pubkey, signature, message))];
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory, bool) {
        KeyStatus storage s = _status[account];
        return (s.registered, s.algorithmId, s.pubkey, s.possessionProven);
    }
}
