// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/IUniswapV2Factory.sol";
import "../interfaces/IWETH.sol";

// import "hardhat/console.sol";

contract LPMigrator is Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    struct RouterCandidate {
        address router;
        address tokenB;
        uint256 proposedTime;
        address[] tokenBToNativeRoute;
        address[] nativeToTokenBRoute;
    }

    address public routerAddress;
    uint256 public approvalDelay;
    address public immutable tokenAddress;
    address public tokenBAddress;
    address[] public tokenBToNativeRoute;
    address[] public nativeToTokenBRoute;
    bool public initialized = false;
    // The last proposed strategy to switch to.
    RouterCandidate public routerCandidate;

    event NewRouterCandidate(address indexed router);
    event UpgradeRouter(address indexed router);

    constructor(
        address _tokenAddress,
        address _routerAddress,
        uint256 _approvalDelay
    ) {
        tokenAddress = _tokenAddress;
        approvalDelay = _approvalDelay;
        routerAddress = _routerAddress;
        initialized = false;
    }

    function proposeRouter(
        address _routerAddress,
        address _tokenB,
        address[] memory _tokenBToNativeRoute,
        address[] memory _nativeToTokenBRoute
    ) external onlyOwner {
        routerCandidate = RouterCandidate({
            router: _routerAddress,
            tokenB: _tokenB,
            tokenBToNativeRoute: _tokenBToNativeRoute,
            nativeToTokenBRoute: _nativeToTokenBRoute,
            proposedTime: block.timestamp
        });

        emit NewRouterCandidate(_routerAddress);
    }

    function upgradeRouter() external onlyOwner {
        require(routerCandidate.router != address(0), "There is no candidate");
        require(
            routerCandidate.proposedTime.add(approvalDelay) < block.timestamp,
            "Delay has not passed"
        );

        _removeLiquidity();

        routerAddress = routerCandidate.router;
        tokenBAddress = routerCandidate.tokenB;
        tokenBToNativeRoute = routerCandidate.tokenBToNativeRoute;
        nativeToTokenBRoute = routerCandidate.nativeToTokenBRoute;

        routerCandidate.router = address(0);
        routerCandidate.proposedTime = 5000000000;

        _addLiquidity();

        emit UpgradeRouter(routerCandidate.router);
    }

    function initializeLiquidity(
        address _tokenBAddress,
        address[] memory _tokenBToNativeRoute,
        address[] memory _nativeToTokenBRoute
    ) external payable onlyOwner {
        require(initialized == false, "!already initialized");

        uint256 tokenBal = IERC20(tokenAddress).balanceOf(address(this));
        require(tokenBal > 0, "!tokenBal == 0");

        address native = IUniswapV2Router02(routerAddress).WETH();
        require(
            _tokenBToNativeRoute[_tokenBToNativeRoute.length - 1] == native,
            "Invalid route"
        );
        require(
            _tokenBToNativeRoute[0] == _tokenBAddress,
            "Invalid native route"
        );

        bool isNative = _tokenBAddress == native;

        if (isNative) {
            IWETH(native).deposit{value: msg.value}();
        } else {
            IUniswapV2Router02(routerAddress)
                .swapExactETHForTokensSupportingFeeOnTransferTokens{
                value: msg.value
            }(1, _nativeToTokenBRoute, address(this), block.timestamp);
        }

        uint256 tokenBBal = IERC20(_tokenBAddress).balanceOf(address(this));
        require(tokenBBal > 0, "!tokenBBal == 0");

        tokenBToNativeRoute = _tokenBToNativeRoute;
        nativeToTokenBRoute = _nativeToTokenBRoute;
        tokenBAddress = _tokenBAddress;

        IERC20(tokenAddress).safeApprove(routerAddress, 0);
        IERC20(tokenAddress).safeApprove(routerAddress, tokenBal);

        IERC20(tokenBAddress).safeApprove(routerAddress, 0);
        IERC20(tokenBAddress).safeApprove(routerAddress, tokenBBal);

        IUniswapV2Router02(routerAddress).addLiquidity(
            tokenAddress,
            tokenBAddress,
            tokenBal,
            tokenBBal,
            0,
            0,
            address(this),
            block.timestamp
        );
        initialized = true;
    }

    function increaseApprovalDelayTo(uint256 _approvalDelay) external onlyOwner {
        require(
            _approvalDelay > approvalDelay,
            "!new approval delay smaller than old"
        );
        approvalDelay = _approvalDelay;
    }

    function _removeLiquidity() internal {
        IUniswapV2Router02 router = IUniswapV2Router02(routerAddress);
        IUniswapV2Factory factory = IUniswapV2Factory(router.factory());
        address pair = factory.getPair(tokenAddress, tokenBAddress);
        uint256 lpBal = IERC20(pair).balanceOf(address(this));

        IERC20(pair).safeApprove(routerAddress, lpBal);
        router.removeLiquidity(
            tokenAddress,
            tokenBAddress,
            lpBal,
            1,
            1,
            address(this),
            block.timestamp
        );

        address native = router.WETH();

        bool isNative = tokenBAddress == native;

        uint256 tokenBBal = IERC20(tokenBAddress).balanceOf(address(this));
        if (!isNative) {
            IERC20(tokenBAddress).safeApprove(routerAddress, 0);
            IERC20(tokenBAddress).safeApprove(routerAddress, tokenBBal);

            router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                tokenBBal,
                0,
                tokenBToNativeRoute,
                address(this),
                block.timestamp
            );
        }
    }

    function _addLiquidity() internal {
        address native = IUniswapV2Router02(routerAddress).WETH();
        uint256 tokenBal = IERC20(tokenAddress).balanceOf(address(this));
        uint256 nativeBal = IERC20(native).balanceOf(address(this));
        require(tokenBal > 0, "!tokenBal == 0");
        require(nativeBal > 0, "!nativeBal == 0");

        IERC20(tokenAddress).safeApprove(routerAddress, 0);
        IERC20(tokenAddress).safeApprove(routerAddress, tokenBal);

        IERC20(native).safeApprove(routerAddress, 0);
        IERC20(native).safeApprove(routerAddress, nativeBal);

        bool isNative = tokenBAddress == native;

        uint256 tokenBBal = nativeBal;
        if (!isNative) {
            IUniswapV2Router02(routerAddress)
                .swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    nativeBal,
                    1,
                    nativeToTokenBRoute,
                    address(this),
                    block.timestamp
                );
            tokenBBal = IERC20(tokenBAddress).balanceOf(address(this));
        }

        // we need to send to lp at least 95% of each token
        IUniswapV2Router02(routerAddress).addLiquidity(
            tokenAddress,
            tokenBAddress,
            tokenBal,
            tokenBBal,
            tokenBal.mul(95).div(100),
            tokenBBal.mul(95).div(100),
            address(this),
            block.timestamp
        );

        // LP can already exist, so remaining token balances we will send to dev addres so that he do smmth with it
        uint256 newTokenBal = IERC20(tokenAddress).balanceOf(address(this));
        if (newTokenBal > 0) {
            IERC20(tokenAddress).safeTransfer(owner(), newTokenBal);
        }
        uint256 newTokenBBal = IERC20(tokenBAddress).balanceOf(address(this));
        if (newTokenBBal > 0) {
            IERC20(tokenBAddress).safeTransfer(owner(), newTokenBBal);
        }
    }
}
