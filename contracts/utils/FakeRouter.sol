// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "../interfaces/IUniswapV2Router02.sol";

// Router that is used to retrieve locked lp from LPMigrator. It doesn't do any swaps or adding liquidity - in a result all left tokens will be sent to LPMigrator owner
contract FakeRouter {
    address immutable realRouter;
    bool public swapCalled;
    bool public addLiquidityCalled;

    constructor(address _realRouter) {
        realRouter = _realRouter;
    }

    function WETH() external view returns (address weth) {
        return IUniswapV2Router02(realRouter).WETH();
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256,
        uint256,
        address[] calldata,
        address,
        uint256
    ) external {
        swapCalled = true;
    }

    function addLiquidity(
        address,
        address,
        uint256,
        uint256,
        uint256,
        uint256,
        address,
        uint256
    )
        external
        returns (
            uint256 amountA,
            uint256 amountB,
            uint256 liquidity
        )
    {
        addLiquidityCalled = true;
        amountA = 0;
        amountB = 0;
        liquidity = 0;
    }
}
