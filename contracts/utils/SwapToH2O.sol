// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IH2OPlugin.sol";
import "../interfaces/IUniswapV2Router02.sol";

abstract contract SwapToH2O is Ownable {
    function h2oAddress() public view virtual returns (address);

    function buyTokensFromToken(
        address router,
        uint256 amount,
        address[] memory route
    ) public returns (bool success) {
        address h2o = h2oAddress();
        require(route.length > 1, "Route need to have at least 2 addresses!");
        require(
            route[route.length - 1] == h2o,
            "Last route address neeed to be hydro!"
        );
        address token = route[0];

        IERC20(token).approve(router, type(uint256).max);
        IERC20(h2o).approve(router, type(uint256).max);

        try
            IUniswapV2Router02(router)
                .swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    amount,
                    0,
                    route,
                    address(this),
                    block.timestamp
                )
        {
            success = true;
        } catch {
            success = false;
        }
    }
}
