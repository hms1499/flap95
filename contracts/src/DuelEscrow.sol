// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title Flap95 DuelEscrow — 1v1 skill-duel stakes settled by an oracle-signed result.
/// @notice Stakes are held in any whitelisted stablecoin; both players stake the same token.
contract DuelEscrow is Ownable, EIP712 {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Accepted, Settled, Cancelled }

    struct Duel {
        address creator;
        address acceptor;
        uint96 stake;
        uint40 createdAt;
        Status status;
        IERC20 token;
    }

    bytes32 public constant SETTLE_TYPEHASH =
        keccak256("Settle(uint256 duelId,address winner,uint32 scoreA,uint32 scoreB)");
    uint256 public constant EXPIRY = 24 hours;
    uint256 public constant FEE_BPS = 500; // 5%

    address public oracle;
    address public treasury;
    uint256 public nextId;
    mapping(uint256 => Duel) public duels;
    mapping(address => bool) public allowedTokens;

    event DuelCreated(uint256 indexed id, address indexed creator, uint96 stake, address token);
    event DuelAccepted(uint256 indexed id, address indexed acceptor);
    event DuelSettled(uint256 indexed id, address winner, uint32 scoreA, uint32 scoreB);
    event DuelCancelled(uint256 indexed id);
    event TokenSet(address indexed token, bool allowed);

    error InvalidStake();
    error InvalidToken();
    error WrongStatus();
    error SelfAccept();
    error NotExpired();
    error BadWinner();
    error BadSignature();

    constructor(IERC20[] memory _tokens, address _oracle, address _treasury, address _owner)
        Ownable(_owner)
        EIP712("Flap95", "1")
    {
        for (uint256 i = 0; i < _tokens.length; i++) {
            allowedTokens[address(_tokens[i])] = true;
            emit TokenSet(address(_tokens[i]), true);
        }
        oracle = _oracle;
        treasury = _treasury;
    }

    function createDuel(IERC20 token, uint96 stake) external returns (uint256 id) {
        if (!allowedTokens[address(token)]) revert InvalidToken();
        // Tiers are 0.1 / 0.5 / 1 whole tokens, scaled to the token's decimals.
        uint256 unit = 10 ** IERC20Metadata(address(token)).decimals();
        if (stake != unit / 10 && stake != unit / 2 && stake != unit) revert InvalidStake();
        id = ++nextId;
        duels[id] = Duel(msg.sender, address(0), stake, uint40(block.timestamp), Status.Open, token);
        token.safeTransferFrom(msg.sender, address(this), stake);
        emit DuelCreated(id, msg.sender, stake, address(token));
    }

    function acceptDuel(uint256 id) external {
        Duel storage d = duels[id];
        if (d.status != Status.Open || block.timestamp > d.createdAt + EXPIRY) revert WrongStatus();
        if (msg.sender == d.creator) revert SelfAccept();
        d.acceptor = msg.sender;
        d.status = Status.Accepted;
        d.token.safeTransferFrom(msg.sender, address(this), d.stake);
        emit DuelAccepted(id, msg.sender);
    }

    function settleDigest(uint256 id, address winner, uint32 scoreA, uint32 scoreB)
        public view returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(SETTLE_TYPEHASH, id, winner, scoreA, scoreB)));
    }

    function settle(uint256 id, address winner, uint32 scoreA, uint32 scoreB, bytes calldata sig) external {
        Duel storage d = duels[id];
        if (d.status != Status.Accepted) revert WrongStatus();
        if (ECDSA.recover(settleDigest(id, winner, scoreA, scoreB), sig) != oracle) revert BadSignature();
        d.status = Status.Settled;
        if (winner == address(0)) {
            d.token.safeTransfer(d.creator, d.stake);
            d.token.safeTransfer(d.acceptor, d.stake);
        } else {
            if (winner != d.creator && winner != d.acceptor) revert BadWinner();
            uint256 pot = uint256(d.stake) * 2;
            uint256 fee = (pot * FEE_BPS) / 10_000;
            d.token.safeTransfer(treasury, fee);
            d.token.safeTransfer(winner, pot - fee);
        }
        emit DuelSettled(id, winner, scoreA, scoreB);
    }

    function cancelExpired(uint256 id) external {
        Duel storage d = duels[id];
        if (d.status != Status.Open) revert WrongStatus();
        if (block.timestamp <= d.createdAt + EXPIRY) revert NotExpired();
        d.status = Status.Cancelled;
        d.token.safeTransfer(d.creator, d.stake);
        emit DuelCancelled(id);
    }

    function setToken(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenSet(token, allowed);
    }

    function setOracle(address o) external onlyOwner { oracle = o; }
    function setTreasury(address t) external onlyOwner { treasury = t; }
}
