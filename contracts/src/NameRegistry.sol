// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * Wallet-owned display names.
 *
 * MiniPay supports no message signing, so a signature cannot prove who owns an
 * address. A transaction can: msg.sender is the proof, which makes
 * impersonation structurally impossible rather than check-dependent.
 *
 * Deliberately minimal:
 *  - No owner, no admin, no upgrade path. Nothing to compromise or rotate.
 *  - Only a byte-length bound. Character rules (1-16 Unicode letters, digits,
 *    space, _ . -) live in normalizeName off-chain, where they are needed
 *    anyway; classifying Unicode on-chain would be expensive and duplicated.
 *  - No uniqueness. Case-folding Unicode in Solidity is a trap; uniqueness is
 *    an index concern and stays in the app's database.
 */
contract NameRegistry {
    mapping(address => string) private _names;

    event NameSet(address indexed owner, string name);

    function setName(string calldata name) external {
        uint256 len = bytes(name).length;
        require(len > 0 && len <= 64, "bad length");
        _names[msg.sender] = name;
        emit NameSet(msg.sender, name);
    }

    function nameOf(address a) external view returns (string memory) {
        return _names[a];
    }
}
