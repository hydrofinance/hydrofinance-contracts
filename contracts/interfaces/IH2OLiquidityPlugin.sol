// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "./IH2OPlugin.sol";

interface IH2OLiquidityPlugin is IH2OPlugin {
    function pair() external returns (address);

    function addLiquidity(uint256 _tokenAmount) external;
}
