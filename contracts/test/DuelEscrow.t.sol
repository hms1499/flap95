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
}
