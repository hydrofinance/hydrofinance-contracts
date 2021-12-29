// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "./IH2OPlugin.sol";

interface IH2ODistributorPlugin is IH2OPlugin {
    function setShare(address shareholder, uint256 amount) external;

    function deposit(uint256 amount) external;

    function process(uint256 gas, bool finishWhenIterationFinished)
        external
        returns (bool);

    function claimDividend(address shareholder) external;
}
