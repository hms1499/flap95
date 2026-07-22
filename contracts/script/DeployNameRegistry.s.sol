// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {NameRegistry} from "../src/NameRegistry.sol";

contract DeployNameRegistry is Script {
    function run() external {
        vm.startBroadcast();
        NameRegistry reg = new NameRegistry();
        vm.stopBroadcast();

        // No constructor arguments and no owner, so the DEFAULT_SENDER trap that
        // produced a permanently ownerless escrow cannot apply here. Still read
        // the deployed code back: a script that "succeeds" without deploying is
        // the failure mode this project has already paid for once.
        require(address(reg).code.length > 0, "no code at deployed address");
        console.log("NameRegistry:", address(reg));
    }
}
