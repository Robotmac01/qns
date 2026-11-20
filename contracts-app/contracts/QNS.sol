// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IQorePQC} from "./interfaces/IQorePQC.sol";

/// @title QNS - Qore Name Service
/// @notice Human-readable `.qore` names for QoreChain accounts.
///
/// Every name has an owner (a normal 0x account) and a guardian: an ML-DSA-87
/// (post-quantum) public key. The actions a thief would want - moving the name,
/// changing where it sends payments, swapping the guardian, pulling protocol
/// fees - are HYBRID: they must come from the owner's account (classical
/// secp256k1 signature on the transaction) AND carry an ML-DSA-87 signature by
/// the guardian, which the contract checks on chain with the pqcVerify
/// precompile. A stolen or quantum-broken classical key alone cannot move a name.
///
/// Low-risk records (text records, primary name) stay classical so everyday
/// use is cheap.
///
/// Names are deliberately NOT ERC-721 tokens: a token standard would give a
/// classical-only `transferFrom` that bypasses the guardian.
contract QNS {
    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------

    /// @dev QoreChain precompiles (see docs: developer-guide/evm-precompiles).
    IQorePQC public constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC public constant PQC_KEY_STATUS = IQorePQC(0x0000000000000000000000000000000000000a02);

    uint256 public constant ML_DSA_87_PUBKEY_LENGTH = 2592;
    uint256 public constant ML_DSA_87_SIG_LENGTH = 4627;
    uint8 public constant ALGO_ML_DSA_87 = 1;

    /// @dev namehash("qore") computed the ENS way.
    bytes32 public constant TLD_NODE = keccak256(abi.encodePacked(bytes32(0), keccak256("qore")));

    /// @dev Domain tag that starts every message the guardian signs.
    bytes32 public constant DOMAIN_TAG = keccak256("QNS-PQ-AUTH-v1");

    uint64 public constant YEAR = 365 days;
    uint64 public constant GRACE_PERIOD = 28 days;
    uint64 public constant MAX_YEARS = 10;
    uint256 public constant MAX_DEADLINE_WINDOW = 1 hours;

    // Action ids. Each one is part of the signed message, so a signature for
    // one action can never be replayed as another.
    uint8 public constant ACTION_REGISTER = 1; // proof of possession of a new guardian
    uint8 public constant ACTION_SET_ADDR = 2;
    uint8 public constant ACTION_TRANSFER = 3;
    uint8 public constant ACTION_ROTATE_GUARDIAN = 4;
    uint8 public constant ACTION_ROTATE_POSSESSION = 5; // new guardian proves it holds its key
    uint8 public constant ACTION_ADMIN_WITHDRAW = 10;
    uint8 public constant ACTION_ADMIN_SET_PRICES = 11;
    uint8 public constant ACTION_ADMIN_TRANSFER = 12;

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    struct Record {
        address owner;
        uint64 expires;
        address addr; // where the name points (payments go here)
        uint64 nonce; // per-name replay counter for guardian signatures
        bytes32 guardian; // keccak256 of the guardian's ML-DSA-87 public key
        uint64 version; // bumps on each fresh registration so old text records disappear
    }

    mapping(bytes32 node => Record) private _records;
    mapping(bytes32 node => string) public labelOf;
    mapping(bytes32 slot => string) private _texts; // keccak(node, version, key)
    mapping(address account => bytes32 node) public primaryNode;

    address public admin;
    bytes32 public adminGuardian;
    uint64 public adminNonce;

    /// @notice Price per year in wei for labels of length 3, 4 and 5+.
    uint256[3] public pricePerYear;

    bool private _locked;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event NameRegistered(bytes32 indexed node, string label, address indexed owner, uint64 expires, bytes32 guardian);
    event NameRenewed(bytes32 indexed node, uint64 expires);
    event AddrChanged(bytes32 indexed node, address addr);
    event NameTransferred(bytes32 indexed node, address indexed from, address indexed to, bytes32 guardian);
    event GuardianRotated(bytes32 indexed node, bytes32 oldGuardian, bytes32 newGuardian);
    event TextChanged(bytes32 indexed node, string key, string value);
    event PrimaryNameSet(address indexed account, bytes32 indexed node);
    event PricesChanged(uint256[3] prices);
    event Withdrawn(address indexed to, uint256 amount);
    event AdminTransferred(address indexed newAdmin, bytes32 newGuardian);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error InvalidLabel();
    error NotAvailable();
    error NotOwner();
    error Expired();
    error BadYears();
    error InsufficientPayment(uint256 required);
    error BadPubkeyLength();
    error BadSignatureLength();
    error WrongGuardian();
    error PqcSignatureInvalid();
    error DeadlinePassed();
    error DeadlineTooFar();
    error AccountKeyMissing();
    error ZeroAddress();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    constructor(bytes32 adminGuardian_, uint256[3] memory prices) {
        if (adminGuardian_ == bytes32(0)) revert WrongGuardian();
        admin = msg.sender;
        adminGuardian = adminGuardian_;
        pricePerYear = prices;
        emit AdminTransferred(msg.sender, adminGuardian_);
        emit PricesChanged(prices);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice namehash("<label>.qore").
    function nodeOf(string memory label) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(TLD_NODE, keccak256(bytes(label))));
    }

    function recordOf(bytes32 node) external view returns (Record memory) {
        return _records[node];
    }

    function available(string calldata label) public view returns (bool) {
        if (!_validLabel(bytes(label))) return false;
        Record storage r = _records[nodeOf(label)];
        return r.owner == address(0) || block.timestamp > uint256(r.expires) + GRACE_PERIOD;
    }

    function rentPrice(string calldata label, uint256 years_) public view returns (uint256) {
        uint256 len = bytes(label).length;
        uint256 tier = len == 3 ? 0 : len == 4 ? 1 : 2;
        return pricePerYear[tier] * years_;
    }

    /// @notice Where `<label>.qore` points, or address(0) if it is free or expired.
    function resolve(string calldata label) external view returns (address) {
        Record storage r = _records[nodeOf(label)];
        if (r.owner == address(0) || block.timestamp > r.expires) return address(0);
        return r.addr;
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _texts[_textSlot(node, key)];
    }

    /// @notice Reverse lookup: the primary name of `account`, if it still owns it.
    function nameOf(address account) external view returns (string memory) {
        bytes32 node = primaryNode[account];
        Record storage r = _records[node];
        if (node == bytes32(0) || r.owner != account || block.timestamp > r.expires) return "";
        return string.concat(labelOf[node], ".qore");
    }

    /// @notice The exact bytes a guardian must sign with ML-DSA-87 for an action.
    ///         Wallets and the CLI call this so they never hand-encode the message.
    function authMessage(uint8 action, bytes32 node, address owner, uint64 nonce, uint256 deadline, bytes32 payloadHash)
        public
        view
        returns (bytes memory)
    {
        return abi.encode(DOMAIN_TAG, block.chainid, address(this), action, node, owner, nonce, deadline, payloadHash);
    }

    // ------------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------------

    /// @notice Register `<label>.qore` for `years_` years.
    /// @param guardianPubkey ML-DSA-87 public key that will guard the name. Pass
    ///        empty bytes to use the caller's own on-chain registered PQC key
    ///        (read through pqcKeyStatus; must have a proven possession).
    /// @param possessionSig  ML-DSA-87 signature by `guardianPubkey` over
    ///        authMessage(ACTION_REGISTER, node, msg.sender, 0, deadline, keccak(pubkey)).
    ///        Not needed (empty) when the account key is used: the chain already
    ///        checked its proof of possession.
    function register(
        string calldata label,
        uint256 years_,
        bytes calldata guardianPubkey,
        bytes calldata possessionSig,
        uint256 deadline
    ) external payable nonReentrant returns (bytes32 node) {
        if (!_validLabel(bytes(label))) revert InvalidLabel();
        if (years_ == 0 || years_ > MAX_YEARS) revert BadYears();
        if (!available(label)) revert NotAvailable();
        uint256 price = rentPrice(label, years_);
        if (msg.value < price) revert InsufficientPayment(price);

        node = nodeOf(label);
        bytes32 guardian;
        if (guardianPubkey.length == 0) {
            guardian = _accountKeyHash(msg.sender);
        } else {
            guardian = _pubkeyHash(guardianPubkey);
            _checkDeadline(deadline);
            _verify(guardianPubkey, possessionSig, authMessage(ACTION_REGISTER, node, msg.sender, 0, deadline, guardian));
        }

        Record storage r = _records[node];
        r.owner = msg.sender;
        r.expires = uint64(block.timestamp + years_ * YEAR);
        r.addr = msg.sender;
        r.guardian = guardian;
        r.version += 1;
        r.nonce += 1; // also invalidates any signature made for a previous owner
        labelOf[node] = label;
        if (primaryNode[msg.sender] == bytes32(0)) {
            primaryNode[msg.sender] = node;
            emit PrimaryNameSet(msg.sender, node);
        }

        emit NameRegistered(node, label, msg.sender, r.expires, guardian);
        _refund(msg.value - price);
    }

    /// @notice Anyone can pay to extend a name (as on ENS).
    function renew(string calldata label, uint256 years_) external payable nonReentrant {
        if (years_ == 0 || years_ > MAX_YEARS) revert BadYears();
        bytes32 node = nodeOf(label);
        Record storage r = _records[node];
        if (r.owner == address(0) || block.timestamp > uint256(r.expires) + GRACE_PERIOD) revert Expired();
        uint256 price = rentPrice(label, years_);
        if (msg.value < price) revert InsufficientPayment(price);
        r.expires += uint64(years_ * YEAR);
        emit NameRenewed(node, r.expires);
        _refund(msg.value - price);
    }

    // ------------------------------------------------------------------
    // Post-quantum guarded actions (owner + guardian signature)
    // ------------------------------------------------------------------

    /// @notice Point the name at a new address. Payments to the name follow it,
    ///         so this is the action an attacker would most want.
    function setAddr(
        bytes32 node,
        address newAddr,
        bytes calldata guardianPubkey,
        bytes calldata guardianSig,
        uint256 deadline
    ) external {
        Record storage r = _ownedLive(node);
        _guard(r, node, ACTION_SET_ADDR, keccak256(abi.encode(newAddr)), guardianPubkey, guardianSig, deadline);
        r.addr = newAddr;
        emit AddrChanged(node, newAddr);
    }

    /// @notice Give the name to `to`, together with the guardian the new owner
    ///         chose (`newGuardian` = keccak256 of their ML-DSA-87 public key).
    function transfer(
        bytes32 node,
        address to,
        bytes32 newGuardian,
        bytes calldata guardianPubkey,
        bytes calldata guardianSig,
        uint256 deadline
    ) external {
        if (to == address(0)) revert ZeroAddress();
        if (newGuardian == bytes32(0)) revert WrongGuardian();
        Record storage r = _ownedLive(node);
        _guard(r, node, ACTION_TRANSFER, keccak256(abi.encode(to, newGuardian)), guardianPubkey, guardianSig, deadline);
        address from = r.owner;
        if (primaryNode[from] == node) {
            delete primaryNode[from];
            emit PrimaryNameSet(from, bytes32(0));
        }
        r.owner = to;
        r.addr = to;
        r.guardian = newGuardian;
        emit NameTransferred(node, from, to, newGuardian);
        emit AddrChanged(node, to);
    }

    /// @notice Replace the guardian key. The old guardian authorises it, and the
    ///         new key proves it is held by signing too.
    function rotateGuardian(
        bytes32 node,
        bytes calldata newPubkey,
        bytes calldata newPossessionSig,
        bytes calldata guardianPubkey,
        bytes calldata guardianSig,
        uint256 deadline
    ) external {
        Record storage r = _ownedLive(node);
        bytes32 newGuardian = _pubkeyHash(newPubkey);
        uint64 nonce = r.nonce;
        _guard(r, node, ACTION_ROTATE_GUARDIAN, newGuardian, guardianPubkey, guardianSig, deadline);
        _verify(newPubkey, newPossessionSig, authMessage(ACTION_ROTATE_POSSESSION, node, r.owner, nonce, deadline, newGuardian));
        bytes32 old = r.guardian;
        r.guardian = newGuardian;
        emit GuardianRotated(node, old, newGuardian);
    }

    // ------------------------------------------------------------------
    // Classical (low-risk) owner actions
    // ------------------------------------------------------------------

    function setText(bytes32 node, string calldata key, string calldata value) external {
        _ownedLive(node);
        _texts[_textSlot(node, key)] = value;
        emit TextChanged(node, key, value);
    }

    function setPrimaryName(bytes32 node) external {
        if (node != bytes32(0)) _ownedLive(node);
        primaryNode[msg.sender] = node;
        emit PrimaryNameSet(msg.sender, node);
    }

    // ------------------------------------------------------------------
    // Admin (also post-quantum guarded)
    // ------------------------------------------------------------------

    function withdraw(address to, uint256 amount, bytes calldata pubkey, bytes calldata sig, uint256 deadline)
        external
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        _guardAdmin(ACTION_ADMIN_WITHDRAW, keccak256(abi.encode(to, amount)), pubkey, sig, deadline);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, amount);
    }

    function setPrices(uint256[3] calldata prices, bytes calldata pubkey, bytes calldata sig, uint256 deadline) external {
        _guardAdmin(ACTION_ADMIN_SET_PRICES, keccak256(abi.encode(prices)), pubkey, sig, deadline);
        pricePerYear = prices;
        emit PricesChanged(prices);
    }

    function transferAdmin(
        address newAdmin,
        bytes32 newGuardian,
        bytes calldata pubkey,
        bytes calldata sig,
        uint256 deadline
    ) external {
        if (newAdmin == address(0)) revert ZeroAddress();
        if (newGuardian == bytes32(0)) revert WrongGuardian();
        _guardAdmin(ACTION_ADMIN_TRANSFER, keccak256(abi.encode(newAdmin, newGuardian)), pubkey, sig, deadline);
        admin = newAdmin;
        adminGuardian = newGuardian;
        emit AdminTransferred(newAdmin, newGuardian);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _ownedLive(bytes32 node) private view returns (Record storage r) {
        r = _records[node];
        if (r.owner != msg.sender) revert NotOwner();
        if (block.timestamp > r.expires) revert Expired();
    }

    function _guard(
        Record storage r,
        bytes32 node,
        uint8 action,
        bytes32 payloadHash,
        bytes calldata pubkey,
        bytes calldata sig,
        uint256 deadline
    ) private {
        _checkDeadline(deadline);
        if (_pubkeyHash(pubkey) != r.guardian) revert WrongGuardian();
        uint64 nonce = r.nonce;
        r.nonce = nonce + 1;
        _verify(pubkey, sig, authMessage(action, node, r.owner, nonce, deadline, payloadHash));
    }

    function _guardAdmin(uint8 action, bytes32 payloadHash, bytes calldata pubkey, bytes calldata sig, uint256 deadline)
        private
    {
        if (msg.sender != admin) revert NotOwner();
        _checkDeadline(deadline);
        if (_pubkeyHash(pubkey) != adminGuardian) revert WrongGuardian();
        uint64 nonce = adminNonce;
        adminNonce = nonce + 1;
        _verify(pubkey, sig, authMessage(action, bytes32(0), admin, nonce, deadline, payloadHash));
    }

    function _verify(bytes calldata pubkey, bytes calldata sig, bytes memory message) private view {
        if (pubkey.length != ML_DSA_87_PUBKEY_LENGTH) revert BadPubkeyLength();
        if (sig.length != ML_DSA_87_SIG_LENGTH) revert BadSignatureLength();
        // An inactive precompile returns empty data rather than reverting, so
        // decode defensively: anything but a clean `true` is a failure.
        (bool ok, bytes memory ret) =
            address(PQC_VERIFY).staticcall(abi.encodeCall(IQorePQC.pqcVerify, (pubkey, sig, message)));
        if (!ok || ret.length != 32 || abi.decode(ret, (uint256)) != 1) revert PqcSignatureInvalid();
    }

    function _accountKeyHash(address account) private view returns (bytes32) {
        (bool ok, bytes memory ret) =
            address(PQC_KEY_STATUS).staticcall(abi.encodeCall(IQorePQC.pqcKeyStatus, (account)));
        if (!ok || ret.length < 128) revert AccountKeyMissing();
        (bool registered, uint8 algo, bytes memory pubkey, bool proven) = abi.decode(ret, (bool, uint8, bytes, bool));
        if (!registered || !proven || algo != ALGO_ML_DSA_87 || pubkey.length != ML_DSA_87_PUBKEY_LENGTH) {
            revert AccountKeyMissing();
        }
        return keccak256(pubkey);
    }

    function _pubkeyHash(bytes calldata pubkey) private pure returns (bytes32) {
        if (pubkey.length != ML_DSA_87_PUBKEY_LENGTH) revert BadPubkeyLength();
        return keccak256(pubkey);
    }

    function _checkDeadline(uint256 deadline) private view {
        if (block.timestamp > deadline) revert DeadlinePassed();
        if (deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert DeadlineTooFar();
    }

    function _textSlot(bytes32 node, string calldata key) private view returns (bytes32) {
        return keccak256(abi.encode(node, _records[node].version, key));
    }

    function _refund(uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev 3-63 chars of a-z, 0-9 and '-', not starting or ending with '-'.
    function _validLabel(bytes memory b) private pure returns (bool) {
        uint256 n = b.length;
        if (n < 3 || n > 63) return false;
        if (b[0] == "-" || b[n - 1] == "-") return false;
        for (uint256 i; i < n; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-";
            if (!ok) return false;
        }
        return true;
    }
}
