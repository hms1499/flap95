// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {NameRegistry} from "../src/NameRegistry.sol";

contract NameRegistryTest is Test {
    NameRegistry reg;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    event NameSet(address indexed owner, string name);

    function setUp() public {
        reg = new NameRegistry();
    }

    function test_setName_storesAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit NameSet(alice, "noctokk");
        vm.prank(alice);
        reg.setName("noctokk");
        assertEq(reg.nameOf(alice), "noctokk");
    }

    function test_unsetAddressReturnsEmpty() public view {
        assertEq(reg.nameOf(bob), "");
    }

    function test_addressesAreIndependent() public {
        vm.prank(alice);
        reg.setName("alice");
        vm.prank(bob);
        reg.setName("bob");
        assertEq(reg.nameOf(alice), "alice");
        assertEq(reg.nameOf(bob), "bob");
    }

    function test_setNameOverwrites() public {
        vm.startPrank(alice);
        reg.setName("first");
        reg.setName("second");
        vm.stopPrank();
        assertEq(reg.nameOf(alice), "second");
    }

    function test_emptyNameReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("bad length"));
        reg.setName("");
    }

    function test_64BytesOk_65Reverts() public {
        // 16 Vietnamese characters can reach 48 UTF-8 bytes; 64 leaves margin.
        string memory ok = _repeat("a", 64);
        string memory tooLong = _repeat("a", 65);
        vm.startPrank(alice);
        reg.setName(ok);
        assertEq(bytes(reg.nameOf(alice)).length, 64);
        vm.expectRevert(bytes("bad length"));
        reg.setName(tooLong);
        vm.stopPrank();
    }

    function test_multibyteNameSurvivesRoundTrip() public {
        vm.prank(alice);
        reg.setName(unicode"Đổi Tên");
        assertEq(reg.nameOf(alice), unicode"Đổi Tên");
    }

    function _repeat(string memory ch, uint256 n) internal pure returns (string memory out) {
        for (uint256 i = 0; i < n; i++) out = string.concat(out, ch);
    }
}
