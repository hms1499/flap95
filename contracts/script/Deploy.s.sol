// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DuelEscrow} from "../src/DuelEscrow.sol";

contract Deploy is Script {
    function run() external {
        address usdm = vm.envAddress("USDM_ADDRESS");
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        vm.startBroadcast();
        new DuelEscrow(IERC20(usdm), oracle, treasury, msg.sender);
        vm.stopBroadcast();
    }
}
