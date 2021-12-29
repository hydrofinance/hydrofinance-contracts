// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

interface IDividendDistributor {
    function changeToken(
        address token,
        address[] memory toNativeRoute,
        address[] memory fromNativeRoute,
        address router,
        bool forceChange
    ) external;

    function setDistributionCriteria(
        uint256 _minPeriod,
        uint256 _minDistribution
    ) external;

    function setShare(address shareholder, uint256 amount) external;

    function deposit() external payable;

    function process(uint256 gas) external;

    function claimDividend(address shareholder) external;

    function checkUnpaidDividends(address shareholder)
        external
        view
        returns (uint256);

    function checkTokenChangeProgress()
        external
        view
        returns (uint256 count, uint256 progress);
}
