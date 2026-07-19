// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
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

        // The owner is named explicitly and never inferred from msg.sender.
        //
        // vm.startBroadcast() changes who SIGNS the transaction; it does not change what
        // the script body sees as msg.sender, which stays forge-std's DEFAULT_SENDER
        // (0x1804c8AB…, literally keccak256("foundry default caller") — an address nobody
        // holds the key to). This script previously passed msg.sender as the owner, and
        // deployment 0x3fEa899FA576d3D1Ae7a6aaa8797Ed91e7a85eA4 on Celo mainnet landed
        // permanently ownerless because of it: setOracle, setTreasury and setToken are all
        // onlyOwner and can never be called on it. It cost ~0.42 CELO and had to be
        // abandoned. The guards below make that failure impossible to repeat silently.
        address owner = vm.envAddress("OWNER_ADDRESS");
        require(owner != DEFAULT_SENDER, "OWNER_ADDRESS is forge DEFAULT_SENDER - contract would be ownerless");
        require(owner != address(0), "OWNER_ADDRESS is the zero address - contract would be ownerless");
        require(oracle != address(0), "ORACLE_ADDRESS unset");
        require(treasury != address(0), "TREASURY_ADDRESS unset");

        vm.startBroadcast();
        DuelEscrow escrow = new DuelEscrow(tokens, oracle, treasury, owner);
        vm.stopBroadcast();

        // Read back from the deployed contract rather than trusting the constructor args:
        // this is the assertion that would have caught the ownerless deploy.
        require(escrow.owner() == owner, "post-deploy owner mismatch");
        require(escrow.oracle() == oracle, "post-deploy oracle mismatch");
        require(escrow.treasury() == treasury, "post-deploy treasury mismatch");

        console.log("DuelEscrow:", address(escrow));
        console.log("  owner:   ", escrow.owner());
        console.log("  oracle:  ", escrow.oracle());
        console.log("  treasury:", escrow.treasury());
    }
}
