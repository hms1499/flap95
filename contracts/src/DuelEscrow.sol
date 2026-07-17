// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title Flap95 DuelEscrow — 1v1 skill-duel stakes settled by an oracle-signed result.
contract DuelEscrow is Ownable, EIP712 {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Accepted, Settled, Cancelled }

    struct Duel {
        address creator;
        address acceptor;
        uint96 stake;
        uint40 createdAt;
        Status status;
    }

    bytes32 public constant SETTLE_TYPEHASH =
        keccak256("Settle(uint256 duelId,address winner,uint32 scoreA,uint32 scoreB)");
    uint256 public constant EXPIRY = 24 hours;
    uint256 public constant FEE_BPS = 500; // 5%

    IERC20 public immutable token;
    address public oracle;
    address public treasury;
    uint256 public nextId;
    mapping(uint256 => Duel) public duels;

    event DuelCreated(uint256 indexed id, address indexed creator, uint96 stake);
    event DuelAccepted(uint256 indexed id, address indexed acceptor);
    event DuelSettled(uint256 indexed id, address winner, uint32 scoreA, uint32 scoreB);
    event DuelCancelled(uint256 indexed id);

    error InvalidStake();
    error WrongStatus();
    error SelfAccept();
    error NotExpired();
    error BadWinner();
    error BadSignature();

    constructor(IERC20 _token, address _oracle, address _treasury, address _owner)
        Ownable(_owner)
        EIP712("Flap95", "1")
    {
        token = _token;
        oracle = _oracle;
        treasury = _treasury;
    }

    function createDuel(uint96 stake) external returns (uint256 id) {
        if (stake != 0.1e18 && stake != 0.5e18 && stake != 1e18) revert InvalidStake();
        id = ++nextId;
        duels[id] = Duel(msg.sender, address(0), stake, uint40(block.timestamp), Status.Open);
        token.safeTransferFrom(msg.sender, address(this), stake);
        emit DuelCreated(id, msg.sender, stake);
    }

    function acceptDuel(uint256 id) external {
        Duel storage d = duels[id];
        if (d.status != Status.Open || block.timestamp > d.createdAt + EXPIRY) revert WrongStatus();
        if (msg.sender == d.creator) revert SelfAccept();
        d.acceptor = msg.sender;
        d.status = Status.Accepted;
        token.safeTransferFrom(msg.sender, address(this), d.stake);
        emit DuelAccepted(id, msg.sender);
    }

    function settle(uint256, address, uint32, uint32, bytes calldata) external pure {
        revert("not implemented"); // Task 5
    }

    function cancelExpired(uint256 id) external {
        Duel storage d = duels[id];
        if (d.status != Status.Open) revert WrongStatus();
        if (block.timestamp <= d.createdAt + EXPIRY) revert NotExpired();
        d.status = Status.Cancelled;
        token.safeTransfer(d.creator, d.stake);
        emit DuelCancelled(id);
    }

    function setOracle(address o) external onlyOwner { oracle = o; }
    function setTreasury(address t) external onlyOwner { treasury = t; }
}
