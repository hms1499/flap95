// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
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

    // Success counters: proof that each path is actually exercised, not just
    // structurally reverting into a vacuously-passing invariant.
    uint256 public createSuccesses;
    uint256 public acceptSuccesses;
    uint256 public settleSuccesses;
    uint256 public refundSuccesses;
    uint256 public cancelSuccesses;

    constructor(DuelEscrow _e, InvToken _t, uint256 _pk, address a, address b, address c) {
        escrow = _e; token = _t; oraclePk = _pk; actors = [a, b, c];
    }

    function createDuel(uint256 actorSeed) public {
        vm.prank(actors[actorSeed % 3]);
        try escrow.createDuel(token, STAKE) returns (uint256 id) {
            openIds.push(id); stakeOf[id] = STAKE; locked += STAKE;
            createSuccesses++;
        } catch {}
    }

    function acceptDuel(uint256 idSeed, uint256 actorSeed) public {
        if (openIds.length == 0) return;
        uint256 idx = idSeed % openIds.length; uint256 id = openIds[idx];
        vm.prank(actors[actorSeed % 3]);
        try escrow.acceptDuel(id) {
            _rmOpen(idx); acceptedIds.push(id); locked += stakeOf[id];
            acceptSuccesses++;
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
            settleSuccesses++;
        } catch {}
    }

    function refundStale(uint256 idSeed, uint256 warpBy) public {
        if (acceptedIds.length == 0) return;
        uint256 idx = idSeed % acceptedIds.length; uint256 id = acceptedIds[idx];
        (,,,,, , uint40 acceptedAt) = escrow.duels(id);
        _warpNear(uint256(acceptedAt) + escrow.SETTLE_TIMEOUT(), warpBy);
        try escrow.refundStale(id) {
            _rmAccepted(idx); locked -= uint256(stakeOf[id]) * 2;
            refundSuccesses++;
        } catch {}
    }

    function cancelExpired(uint256 idSeed, uint256 warpBy) public {
        if (openIds.length == 0) return;
        uint256 idx = idSeed % openIds.length; uint256 id = openIds[idx];
        (,, , uint40 createdAt,,,) = escrow.duels(id);
        _warpNear(uint256(createdAt) + escrow.EXPIRY(), warpBy);
        try escrow.cancelExpired(id) {
            _rmOpen(idx); locked -= stakeOf[id];
            cancelSuccesses++;
        } catch {}
    }

    /// Warp forward (never backward) to a point near `deadline`: half the time
    /// just short of it (exercises the NotExpired revert path), half the time
    /// at-or-past it (exercises the success path). Bounded jitter keeps the
    /// jump small so it doesn't blow past other duels' own deadlines and
    /// starve them, unlike the old unconditional `% 3 days` warp.
    function _warpNear(uint256 deadline, uint256 warpBy) internal {
        uint256 jitter = warpBy % 2 hours;
        uint256 dest = warpBy % 2 == 0
            ? deadline + jitter
            : (deadline > jitter ? deadline - jitter : deadline);
        if (dest > block.timestamp) vm.warp(dest);
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

    /// @notice Proves each handler action path was actually exercised (not just
    /// structurally non-reverting). A path with a zero or implausibly low
    /// success count means the invariant above is passing vacuously for it.
    ///
    /// Gated on createSuccesses > 0: Foundry persists a shrunk counterexample
    /// for a failing invariant to cache/invariant/failures/... and replays it
    /// on the next run. A shrunk replay is typically a single call, so all
    /// five counters can legitimately be 0 even though invariant_escrowSolvent
    /// itself passes on that short sequence. Without this guard, afterInvariant
    /// would then fail on every replay of any recorded failure (stale or
    /// genuine), keeping the suite red until `forge clean` and muddying the
    /// diagnosis of a real solvency break by piling unrelated assertion
    /// failures on top of it. createSuccesses > 0 is a reasonable proxy for
    /// "a real campaign ran" since every other path requires a created duel
    /// first.
    function afterInvariant() public view {
        console.log("createSuccesses", handler.createSuccesses());
        console.log("acceptSuccesses", handler.acceptSuccesses());
        console.log("settleSuccesses", handler.settleSuccesses());
        console.log("refundSuccesses", handler.refundSuccesses());
        console.log("cancelSuccesses", handler.cancelSuccesses());
        if (handler.createSuccesses() > 0) {
            assertGt(handler.acceptSuccesses(), 0);
            assertGt(handler.settleSuccesses(), 0);
            assertGt(handler.refundSuccesses(), 0);
            assertGt(handler.cancelSuccesses(), 0);
        } else {
            console.log("afterInvariant: coverage assertions skipped (createSuccesses == 0) -- this is a replay of a recorded failure or a degenerate campaign, not a full run");
        }
    }
}
