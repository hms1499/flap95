// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DuelEscrow} from "../src/DuelEscrow.sol";

contract MockUSD is ERC20 {
    constructor() ERC20("Mock USDm", "USDm") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract DuelEscrowTest is Test {
    MockUSD token;
    DuelEscrow escrow;
    uint256 oraclePk = 0xA11CE;
    address oracle;
    address treasury = address(0xFEE);
    address alice = address(0xA);
    address bob = address(0xB);

    function setUp() public {
        oracle = vm.addr(oraclePk);
        token = new MockUSD();
        escrow = new DuelEscrow(token, oracle, treasury, address(this));
        token.mint(alice, 100e18);
        token.mint(bob, 100e18);
        vm.prank(alice); token.approve(address(escrow), type(uint256).max);
        vm.prank(bob); token.approve(address(escrow), type(uint256).max);
    }

    function _create(uint96 stake) internal returns (uint256 id) {
        vm.prank(alice);
        id = escrow.createDuel(stake);
    }

    function test_createDuel_escrowsStake() public {
        uint256 id = _create(0.1e18);
        assertEq(id, 1);
        assertEq(token.balanceOf(address(escrow)), 0.1e18);
        (address creator,, uint96 stake,, DuelEscrow.Status status) = escrow.duels(id);
        assertEq(creator, alice);
        assertEq(stake, 0.1e18);
        assertEq(uint8(status), uint8(DuelEscrow.Status.Open));
    }

    function test_createDuel_rejectsBadTier() public {
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.InvalidStake.selector);
        escrow.createDuel(0.2e18);
    }

    function test_acceptDuel_locksBothStakes() public {
        uint256 id = _create(0.5e18);
        vm.prank(bob); escrow.acceptDuel(id);
        assertEq(token.balanceOf(address(escrow)), 1e18);
        (, address acceptor,,, DuelEscrow.Status status) = escrow.duels(id);
        assertEq(acceptor, bob);
        assertEq(uint8(status), uint8(DuelEscrow.Status.Accepted));
    }

    function test_acceptDuel_rejectsSelfAccept() public {
        uint256 id = _create(0.1e18);
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.SelfAccept.selector);
        escrow.acceptDuel(id);
    }

    function test_acceptDuel_rejectsExpired() public {
        uint256 id = _create(0.1e18);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(bob);
        vm.expectRevert(DuelEscrow.WrongStatus.selector);
        escrow.acceptDuel(id);
    }

    function test_cancelExpired_refundsCreator() public {
        uint256 id = _create(1e18);
        vm.warp(block.timestamp + 24 hours + 1);
        escrow.cancelExpired(id);
        assertEq(token.balanceOf(alice), 100e18);
        (,,,, DuelEscrow.Status status) = escrow.duels(id);
        assertEq(uint8(status), uint8(DuelEscrow.Status.Cancelled));
    }

    function test_cancelExpired_rejectsBeforeDeadline() public {
        uint256 id = _create(1e18);
        vm.expectRevert(DuelEscrow.NotExpired.selector);
        escrow.cancelExpired(id);
    }

    function _sign(uint256 id, address winner, uint32 a, uint32 b) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, escrow.settleDigest(id, winner, a, b));
        return abi.encodePacked(r, s, v);
    }

    function _acceptedDuel() internal returns (uint256 id) {
        id = _create(1e18);
        vm.prank(bob); escrow.acceptDuel(id);
    }

    function test_settle_paysWinnerMinusFee() public {
        uint256 id = _acceptedDuel();
        escrow.settle(id, bob, 3, 7, _sign(id, bob, 3, 7));
        assertEq(token.balanceOf(bob), 99e18 + 1.9e18);      // staked 1, won 1.9
        assertEq(token.balanceOf(treasury), 0.1e18);          // 5% of 2.0
        (,,,, DuelEscrow.Status status) = escrow.duels(id);
        assertEq(uint8(status), uint8(DuelEscrow.Status.Settled));
    }

    function test_settle_tieRefundsBothNoFee() public {
        uint256 id = _acceptedDuel();
        escrow.settle(id, address(0), 4, 4, _sign(id, address(0), 4, 4));
        assertEq(token.balanceOf(alice), 100e18);
        assertEq(token.balanceOf(bob), 100e18);
        assertEq(token.balanceOf(treasury), 0);
    }

    function test_settle_rejectsNonOracleSignature() public {
        uint256 id = _acceptedDuel();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, escrow.settleDigest(id, bob, 1, 2));
        vm.expectRevert(DuelEscrow.BadSignature.selector);
        escrow.settle(id, bob, 1, 2, abi.encodePacked(r, s, v));
    }

    function test_settle_rejectsForeignWinner() public {
        uint256 id = _acceptedDuel();
        address mallory = address(0xBEEF);
        bytes memory sig = _sign(id, mallory, 9, 1);
        vm.expectRevert(DuelEscrow.BadWinner.selector);
        escrow.settle(id, mallory, 9, 1, sig);
    }

    function test_settle_rejectsDoubleSettle() public {
        uint256 id = _acceptedDuel();
        escrow.settle(id, bob, 3, 7, _sign(id, bob, 3, 7));
        bytes memory sig = _sign(id, bob, 3, 7);
        vm.expectRevert(DuelEscrow.WrongStatus.selector);
        escrow.settle(id, bob, 3, 7, sig);
    }

    function test_settle_rejectsOpenDuel() public {
        uint256 id = _create(0.1e18);
        bytes memory sig = _sign(id, alice, 1, 0);
        vm.expectRevert(DuelEscrow.WrongStatus.selector);
        escrow.settle(id, alice, 1, 0, sig);
    }

    function testFuzz_settle_conservesFunds(uint32 a, uint32 b) public {
        uint256 id = _acceptedDuel();
        address winner = a == b ? address(0) : (a > b ? alice : bob);
        escrow.settle(id, winner, a, b, _sign(id, winner, a, b));
        assertEq(
            token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(treasury),
            200e18
        );
        assertEq(token.balanceOf(address(escrow)), 0);
    }
}
