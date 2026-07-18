// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DuelEscrow} from "../src/DuelEscrow.sol";

contract MockToken is ERC20 {
    uint8 private immutable _decimals;
    constructor(string memory sym, uint8 dec) ERC20(sym, sym) { _decimals = dec; }
    function decimals() public view override returns (uint8) { return _decimals; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract DuelEscrowTest is Test {
    MockToken usdm;   // 18 decimals (cUSD-like)
    MockToken usdc;   // 6 decimals (USDC/USDT-like)
    DuelEscrow escrow;
    uint256 oraclePk = 0xA11CE;
    address oracle;
    address treasury = address(0xFEE);
    address alice = address(0xA);
    address bob = address(0xB);

    function setUp() public {
        oracle = vm.addr(oraclePk);
        usdm = new MockToken("USDm", 18);
        usdc = new MockToken("USDC", 6);
        IERC20[] memory tokens = new IERC20[](2);
        tokens[0] = usdm;
        tokens[1] = usdc;
        escrow = new DuelEscrow(tokens, oracle, treasury, address(this));
        usdm.mint(alice, 100e18);
        usdm.mint(bob, 100e18);
        usdc.mint(alice, 100e6);
        usdc.mint(bob, 100e6);
        vm.startPrank(alice);
        usdm.approve(address(escrow), type(uint256).max);
        usdc.approve(address(escrow), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        usdm.approve(address(escrow), type(uint256).max);
        usdc.approve(address(escrow), type(uint256).max);
        vm.stopPrank();
    }

    function _create(IERC20 token, uint96 stake) internal returns (uint256 id) {
        vm.prank(alice);
        id = escrow.createDuel(token, stake);
    }

    function test_createDuel_escrowsStake() public {
        uint256 id = _create(usdm, 0.1e18);
        assertEq(id, 1);
        assertEq(usdm.balanceOf(address(escrow)), 0.1e18);
        (address creator,, uint96 stake,, DuelEscrow.Status status, IERC20 token,) = escrow.duels(id);
        assertEq(creator, alice);
        assertEq(stake, 0.1e18);
        assertEq(uint8(status), uint8(DuelEscrow.Status.Open));
        assertEq(address(token), address(usdm));
    }

    function test_createDuel_sixDecimalTiers() public {
        uint256 id = _create(usdc, 0.1e6);
        assertEq(usdc.balanceOf(address(escrow)), 0.1e6);
        (,, uint96 stake,,, IERC20 token,) = escrow.duels(id);
        assertEq(stake, 0.1e6);
        assertEq(address(token), address(usdc));
    }

    function test_createDuel_rejectsWrongDecimalsTier() public {
        // an 18-decimal amount on a 6-decimal token is not a valid tier
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.InvalidStake.selector);
        escrow.createDuel(usdc, 0.1e18);
    }

    function test_createDuel_rejectsBadTier() public {
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.InvalidStake.selector);
        escrow.createDuel(usdm, 0.2e18);
    }

    function test_createDuel_rejectsUnlistedToken() public {
        MockToken rogue = new MockToken("RGE", 18);
        rogue.mint(alice, 100e18);
        vm.startPrank(alice);
        rogue.approve(address(escrow), type(uint256).max);
        vm.expectRevert(DuelEscrow.InvalidToken.selector);
        escrow.createDuel(rogue, 0.1e18);
        vm.stopPrank();
    }

    function test_setToken_ownerCanDelist() public {
        escrow.setToken(address(usdc), false);
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.InvalidToken.selector);
        escrow.createDuel(usdc, 0.1e6);
    }

    function test_setToken_rejectsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        escrow.setToken(address(usdc), false);
    }

    function test_acceptDuel_locksBothStakes() public {
        uint256 id = _create(usdm, 0.5e18);
        vm.prank(bob); escrow.acceptDuel(id);
        assertEq(usdm.balanceOf(address(escrow)), 1e18);
        (, address acceptor,,, DuelEscrow.Status status,,) = escrow.duels(id);
        assertEq(acceptor, bob);
        assertEq(uint8(status), uint8(DuelEscrow.Status.Accepted));
    }

    function test_acceptDuel_pullsSameToken() public {
        uint256 id = _create(usdc, 1e6);
        vm.prank(bob); escrow.acceptDuel(id);
        assertEq(usdc.balanceOf(address(escrow)), 2e6);
        assertEq(usdc.balanceOf(bob), 99e6);
        assertEq(usdm.balanceOf(bob), 100e18); // untouched
    }

    function test_acceptDuel_rejectsSelfAccept() public {
        uint256 id = _create(usdm, 0.1e18);
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.SelfAccept.selector);
        escrow.acceptDuel(id);
    }

    function test_acceptDuel_rejectsExpired() public {
        uint256 id = _create(usdm, 0.1e18);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(bob);
        vm.expectRevert(DuelEscrow.WrongStatus.selector);
        escrow.acceptDuel(id);
    }

    function test_cancelExpired_refundsCreator() public {
        uint256 id = _create(usdm, 1e18);
        vm.warp(block.timestamp + 24 hours + 1);
        escrow.cancelExpired(id);
        assertEq(usdm.balanceOf(alice), 100e18);
        (,,,, DuelEscrow.Status status,,) = escrow.duels(id);
        assertEq(uint8(status), uint8(DuelEscrow.Status.Cancelled));
    }

    function test_cancelExpired_rejectsBeforeDeadline() public {
        uint256 id = _create(usdm, 1e18);
        vm.expectRevert(DuelEscrow.NotExpired.selector);
        escrow.cancelExpired(id);
    }

    function _sign(uint256 id, address winner, uint32 a, uint32 b) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, escrow.settleDigest(id, winner, a, b));
        return abi.encodePacked(r, s, v);
    }

    function _acceptedDuel(IERC20 token, uint96 stake) internal returns (uint256 id) {
        id = _create(token, stake);
        vm.prank(bob); escrow.acceptDuel(id);
    }

    function test_settle_paysWinnerMinusFee() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        escrow.settle(id, bob, 3, 7, _sign(id, bob, 3, 7));
        assertEq(usdm.balanceOf(bob), 99e18 + 1.9e18);      // staked 1, won 1.9
        assertEq(usdm.balanceOf(treasury), 0.1e18);          // 5% of 2.0
        (,,,, DuelEscrow.Status status,,) = escrow.duels(id);
        assertEq(uint8(status), uint8(DuelEscrow.Status.Settled));
    }

    function test_settle_paysInDuelToken() public {
        uint256 id = _acceptedDuel(usdc, 1e6);
        escrow.settle(id, bob, 3, 7, _sign(id, bob, 3, 7));
        assertEq(usdc.balanceOf(bob), 99e6 + 1.9e6);
        assertEq(usdc.balanceOf(treasury), 0.1e6);
        assertEq(usdm.balanceOf(treasury), 0); // fee never taken in another token
    }

    function test_settle_tieRefundsBothNoFee() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        escrow.settle(id, address(0), 4, 4, _sign(id, address(0), 4, 4));
        assertEq(usdm.balanceOf(alice), 100e18);
        assertEq(usdm.balanceOf(bob), 100e18);
        assertEq(usdm.balanceOf(treasury), 0);
    }

    function test_settle_rejectsNonOracleSignature() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, escrow.settleDigest(id, bob, 1, 2));
        vm.expectRevert(DuelEscrow.BadSignature.selector);
        escrow.settle(id, bob, 1, 2, abi.encodePacked(r, s, v));
    }

    function test_settle_rejectsForeignWinner() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        address mallory = address(0xBEEF);
        bytes memory sig = _sign(id, mallory, 9, 1);
        vm.expectRevert(DuelEscrow.BadWinner.selector);
        escrow.settle(id, mallory, 9, 1, sig);
    }

    function test_settle_rejectsDoubleSettle() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        escrow.settle(id, bob, 3, 7, _sign(id, bob, 3, 7));
        bytes memory sig = _sign(id, bob, 3, 7);
        vm.expectRevert(DuelEscrow.WrongStatus.selector);
        escrow.settle(id, bob, 3, 7, sig);
    }

    function test_settle_rejectsOpenDuel() public {
        uint256 id = _create(usdm, 0.1e18);
        bytes memory sig = _sign(id, alice, 1, 0);
        vm.expectRevert(DuelEscrow.WrongStatus.selector);
        escrow.settle(id, alice, 1, 0, sig);
    }

    function _settleAndCheckConservation(IERC20 token, uint96 stake, uint256 total, uint32 a, uint32 b) internal {
        uint256 id = _acceptedDuel(token, stake);
        address winner = a == b ? address(0) : (a > b ? alice : bob);
        bytes memory sig = _sign(id, winner, a, b);
        escrow.settle(id, winner, a, b, sig);
        assertEq(
            token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(treasury),
            total
        );
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzz_settle_conservesFunds(uint32 a, uint32 b, bool useUsdc) public {
        if (useUsdc) _settleAndCheckConservation(usdc, 1e6, 200e6, a, b);
        else _settleAndCheckConservation(usdm, 1e18, 200e18, a, b);
    }

    function test_acceptDuel_recordsAcceptedAt() public {
        uint256 id = _create(usdm, 1e18);
        vm.warp(block.timestamp + 100);
        uint256 t = block.timestamp;
        vm.prank(bob); escrow.acceptDuel(id);
        (,,,,,, uint40 acceptedAt) = escrow.duels(id);
        assertEq(uint256(acceptedAt), t);
    }

    function test_refundStale_refundsBothAfterTimeout() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        vm.warp(block.timestamp + escrow.SETTLE_TIMEOUT() + 1);
        vm.expectEmit(true, false, false, false);
        emit DuelEscrow.DuelRefunded(id);
        escrow.refundStale(id);
        assertEq(usdm.balanceOf(alice), 100e18);
        assertEq(usdm.balanceOf(bob), 100e18);
        assertEq(usdm.balanceOf(address(escrow)), 0);
        (,,,, DuelEscrow.Status status,,) = escrow.duels(id);
        assertEq(uint8(status), uint8(DuelEscrow.Status.Cancelled));
    }

    function test_refundStale_rejectsBeforeTimeout() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        vm.expectRevert(DuelEscrow.NotExpired.selector);
        escrow.refundStale(id);
    }

    function test_refundStale_rejectsOpenDuel() public {
        uint256 id = _create(usdm, 1e18);
        vm.warp(block.timestamp + escrow.SETTLE_TIMEOUT() + 1);
        vm.expectRevert(DuelEscrow.WrongStatus.selector);
        escrow.refundStale(id);
    }

    function test_refundStale_rejectsDoubleCall() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        vm.warp(block.timestamp + escrow.SETTLE_TIMEOUT() + 1);
        escrow.refundStale(id);
        vm.expectRevert(DuelEscrow.WrongStatus.selector);
        escrow.refundStale(id);
    }
}
