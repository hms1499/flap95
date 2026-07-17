// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DuelEscrow} from "../src/DuelEscrow.sol";

contract Deploy is Script {
    function run() external {
        IERC20[] memory tokens = new IERC20[](3);
        tokens[0] = IERC20(vm.envAddress("USDM_ADDRESS"));
        tokens[1] = IERC20(vm.envAddress("USDC_ADDRESS"));
        tokens[2] = IERC20(vm.envAddress("USDT_ADDRESS"));
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        vm.startBroadcast();
        new DuelEscrow(tokens, oracle, treasury, msg.sender);
        vm.stopBroadcast();
    }
}
