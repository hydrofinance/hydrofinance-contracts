// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

interface IH2OPlugin {
    function retirePlugin() external;

    function h2oAddress() external view returns (address);

    function retrieveH2OTokens(uint256 amount) external;
}
