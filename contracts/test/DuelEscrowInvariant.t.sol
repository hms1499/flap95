// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DuelEscrow} from "../src/DuelEscrow.sol";

contract InvToken is ERC20 {
    constructor() ERC20("USDm", "USDm") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract Handler is Test {
    DuelEscrow public escrow;
    InvToken public token;
    uint256 immutable oraclePk;
    address[3] actors;
    uint256[] public openIds;
    uint256[] public acceptedIds;
    mapping(uint256 => uint96) public stakeOf;
    uint256 public locked; // ghost: exact tokens that should sit in escrow
    uint96 constant STAKE = 1e18;

    constructor(DuelEscrow _e, InvToken _t, uint256 _pk, address a, address b, address c) {
        escrow = _e; token = _t; oraclePk = _pk; actors = [a, b, c];
    }

    function createDuel(uint256 actorSeed) public {
        vm.prank(actors[actorSeed % 3]);
        try escrow.createDuel(token, STAKE) returns (uint256 id) {
            openIds.push(id); stakeOf[id] = STAKE; locked += STAKE;
        } catch {}
    }

    function acceptDuel(uint256 idSeed, uint256 actorSeed) public {
        if (openIds.length == 0) return;
        uint256 idx = idSeed % openIds.length; uint256 id = openIds[idx];
        vm.prank(actors[actorSeed % 3]);
        try escrow.acceptDuel(id) {
            _rmOpen(idx); acceptedIds.push(id); locked += stakeOf[id];
        } catch {}
    }

    function settle(uint256 idSeed, uint256 wSeed) public {
        if (acceptedIds.length == 0) return;
        uint256 idx = idSeed % acceptedIds.length; uint256 id = acceptedIds[idx];
        (address creator, address acceptor,,,,,) = escrow.duels(id);
        address winner = wSeed % 3 == 0 ? address(0) : (wSeed % 3 == 1 ? creator : acceptor);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, escrow.settleDigest(id, winner, 1, 2));
        try escrow.settle(id, winner, 1, 2, abi.encodePacked(r, s, v)) {
            _rmAccepted(idx); locked -= uint256(stakeOf[id]) * 2;
        } catch {}
    }

    function refundStale(uint256 idSeed, uint256 warpBy) public {
        if (acceptedIds.length == 0) return;
        uint256 idx = idSeed % acceptedIds.length; uint256 id = acceptedIds[idx];
        vm.warp(block.timestamp + (warpBy % 3 days));
        try escrow.refundStale(id) {
            _rmAccepted(idx); locked -= uint256(stakeOf[id]) * 2;
        } catch {}
    }

    function cancelExpired(uint256 idSeed, uint256 warpBy) public {
        if (openIds.length == 0) return;
        uint256 idx = idSeed % openIds.length; uint256 id = openIds[idx];
        vm.warp(block.timestamp + (warpBy % 3 days));
        try escrow.cancelExpired(id) {
            _rmOpen(idx); locked -= stakeOf[id];
        } catch {}
    }

    function _rmOpen(uint256 i) internal { openIds[i] = openIds[openIds.length - 1]; openIds.pop(); }
    function _rmAccepted(uint256 i) internal { acceptedIds[i] = acceptedIds[acceptedIds.length - 1]; acceptedIds.pop(); }
}

contract DuelEscrowInvariantTest is StdInvariant, Test {
    DuelEscrow escrow;
    InvToken token;
    Handler handler;
    uint256 oraclePk = 0xA11CE;

    function setUp() public {
        token = new InvToken();
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = token;
        escrow = new DuelEscrow(tokens, vm.addr(oraclePk), address(0xFEE), address(this));
        address a = address(0xA1); address b = address(0xB1); address c = address(0xC1);
        handler = new Handler(escrow, token, oraclePk, a, b, c);
        address[3] memory who = [a, b, c];
        for (uint256 i = 0; i < 3; i++) {
            token.mint(who[i], 1_000_000e18);
            vm.prank(who[i]);
            token.approve(address(escrow), type(uint256).max);
        }
        targetContract(address(handler));
    }

    function invariant_escrowSolvent() public view {
        assertEq(token.balanceOf(address(escrow)), handler.locked());
    }
}
