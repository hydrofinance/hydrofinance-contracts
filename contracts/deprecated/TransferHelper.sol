// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/IUniswapV2Factory.sol";

// import "hardhat/console.sol";

abstract contract TransferHelper is Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    event AutoLiquify(uint256 tokenAAmount, uint256 tokenBAmount);

    IUniswapV2Router02 public router;
    address routerAddress;
    address native;
    bool isTokenBNative;

    address[] public toNativeRoute;
    address[] public fromNativeRoute;
    address[] public toTokenBRoute;
    address public pair;
    address public tokenB;

    address public autoLiquidityReceiver;

    constructor(address _routerAddress, address _tokenB) {
        routerAddress = _routerAddress;
        tokenB = _tokenB;
        router = IUniswapV2Router02(_routerAddress);
        native = router.WETH();
        autoLiquidityReceiver = msg.sender;

        address factory = router.factory();
        pair = IUniswapV2Factory(factory).createPair(address(this), tokenB);

        if (tokenB == native) {
            toNativeRoute = [address(this), tokenB];
            fromNativeRoute = [tokenB, address(this)];
        } else {
            toNativeRoute = [address(this), tokenB, native];
            fromNativeRoute = [native, tokenB, address(this)];
        }
        toTokenBRoute = [native, tokenB];

        isTokenBNative = tokenB == native;

        onNewRouter(routerAddress, pair);
        checkRoutesValid();
    }

    function onBeforeNewRouter(address) internal virtual {
        IERC20(tokenB).safeApprove(routerAddress, 0);
    }

    function onNewRouter(address, address) internal virtual {
        IERC20(tokenB).safeApprove(routerAddress, 0);
        IERC20(tokenB).safeApprove(routerAddress, type(uint128).max);
    }

    function changeLiquiditiyPair(
        address _routerAddress,
        address _pair,
        address[] memory _toNativeRoute,
        address[] memory _fromNativeRoute,
        address[] memory _toTokenBRoute
    ) public onlyOwner {
        onBeforeNewRouter(routerAddress);

        routerAddress = _routerAddress;
        router = IUniswapV2Router02(routerAddress);
        pair = _pair;
        toNativeRoute = _toNativeRoute;
        fromNativeRoute = _fromNativeRoute;
        toTokenBRoute = _toTokenBRoute;
        tokenB = _toTokenBRoute[_toTokenBRoute.length - 1];
        if (tokenB == native) {
            isTokenBNative = true;
        } else {
            isTokenBNative = false;
        }

        onNewRouter(routerAddress, pair);
        checkRoutesValid();
    }

    function swapToMOVR(uint256 amountToSwap)
        internal
        returns (uint256 swapedMovrAmount)
    {
        uint256 balanceBefore = address(this).balance;

        IERC20(address(this)).safeApprove(routerAddress, 0);
        IERC20(address(this)).safeApprove(routerAddress, type(uint128).max);

        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            amountToSwap,
            1,
            toNativeRoute,
            address(this),
            block.timestamp
        );

        return address(this).balance - balanceBefore;
    }

    function addLiquidity(uint256 _movrAmount, uint256 _tokenAmount) internal {
        if (isTokenBNative) {
            router.addLiquidityETH{value: _movrAmount}(
                address(this),
                _tokenAmount,
                0,
                0,
                autoLiquidityReceiver,
                block.timestamp
            );
            emit AutoLiquify(_tokenAmount, _movrAmount);
        } else {
            uint256 beforeBal = IERC20(tokenB).balanceOf(address(this));
            router.swapExactETHForTokensSupportingFeeOnTransferTokens{
                value: _movrAmount
            }(0, toTokenBRoute, address(this), block.timestamp);
            uint256 afterBal = IERC20(tokenB).balanceOf(address(this));
            uint256 tokenBAmount = afterBal.sub(beforeBal);

            router.addLiquidity(
                address(this),
                tokenB,
                _tokenAmount,
                tokenBAmount,
                0,
                0,
                autoLiquidityReceiver,
                block.timestamp
            );

            emit AutoLiquify(_tokenAmount, tokenBAmount);
        }
    }

    function setFeeReceivers(address _autoLiquidityReceiver)
        external
        onlyOwner
    {
        autoLiquidityReceiver = _autoLiquidityReceiver;
    }

    function buyTokens(uint256 amount, address to) internal {
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{
            value: amount
        }(0, fromNativeRoute, to, block.timestamp);
    }

    function buyTokensFromToken(
        uint256 amount,
        address to,
        address token,
        address[] memory route
    ) internal {
        require(route.length > 1, "Route need to have at least 2 addresses!");
        require(
            route[route.length - 1] == address(this),
            "Last route address neeed to be hydro!"
        );

        if (token != tokenB) {
            IERC20(token).safeApprove(routerAddress, 0);
            IERC20(token).safeApprove(routerAddress, type(uint128).max);
        }
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amount,
            0,
            route,
            to,
            block.timestamp
        );
    }

    function checkRoutesValid() private view {
        require(toNativeRoute[0] == address(this), "toNativeRoute[0] != hydro");
        require(
            toNativeRoute[toNativeRoute.length - 1] == native,
            "toNativeRoute[last] != native"
        );
        require(fromNativeRoute[0] == native, "fromNativeRoute[0] != native");
        require(
            fromNativeRoute[fromNativeRoute.length - 1] == address(this),
            "fromNativeRoute[last] != hydro"
        );
    }
}
