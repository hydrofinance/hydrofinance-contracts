// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/IUniswapV2Factory.sol";
import "../interfaces/IH2OLiquidityPlugin.sol";
import "../interfaces/IPairChange.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "../utils/SwapToH2O.sol";

// import "hardhat/console.sol";

contract H2OLiquidityPlugin is IH2OLiquidityPlugin, Ownable, SwapToH2O {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    event AutoLiquify(uint256 amount);

    address _h2oAddress;

    IUniswapV2Router02 public router;
    address routerAddress;

    address public override pair;

    modifier onlyH2OOrOwner() {
        require(
            owner() == _msgSender() || _h2oAddress == _msgSender(),
            "Caller should be either owner or h2o contract"
        );
        _;
    }

    constructor(address _hydroAddress) {
        _h2oAddress = _hydroAddress;
    }

    function h2oAddress()
        public
        view
        override(IH2OPlugin, SwapToH2O)
        returns (address addr)
    {
        addr = _h2oAddress;
    }

    function setupLiquiditiyPair(address _routerAddress, address _pair)
        external
        onlyOwner
    {
        require(routerAddress == address(0), "Already configured");

        _changeLiquiditiyPair(_routerAddress, _pair);
    }

    function changeLiquiditiyPair(address _routerAddress, address _pair)
        public
        onlyOwner
    {
        _changeLiquiditiyPair(_routerAddress, _pair);
        IPairChange(_h2oAddress).onPairChange();
    }

    function addLiquidity(uint256 _tokenAmount)
        external
        override
        onlyH2OOrOwner
    {
        _transferH2OToSelf(_tokenAmount, _msgSender());
        uint256 bal = _getH2OBalance();
        IERC20(_h2oAddress).safeTransfer(pair, bal);
        emit AutoLiquify(bal);
    }

    function retrieveH2OTokens(uint256 amount) external override onlyOwner {
        _retrieveH2OTokens(amount);
    }

    function retirePlugin() external override onlyH2OOrOwner {
        uint256 h2oBal = IERC20(_h2oAddress).balanceOf(address(this));
        if (h2oBal > 0) {
            _retrieveH2OTokens(h2oBal);
        }
    }

    function _onBeforeNewRouter(address) private {
        if (routerAddress != address(0)) {
            IERC20(_h2oAddress).approve(routerAddress, 0);
        }
    }

    function _onNewRouter(address, address) private {
        IERC20(_h2oAddress).approve(routerAddress, type(uint256).max);
    }

    function _transferH2OToSelf(uint256 amountToSwap, address from)
        private
        returns (uint256 transferredAmount)
    {
        uint256 h2oBalanceBefore = _getH2OBalance();
        IERC20(_h2oAddress).safeTransferFrom(from, address(this), amountToSwap);
        transferredAmount = _getH2OBalance() - h2oBalanceBefore;
    }

    function _getH2OBalance() private view returns (uint256 balance) {
        balance = IERC20(_h2oAddress).balanceOf(address(this));
    }

    function _validatePair() private view {
        address token0 = IUniswapV2Pair(pair).token0();
        address token1 = IUniswapV2Pair(pair).token1();
        require(
            token0 == _h2oAddress || token1 == _h2oAddress,
            "Invalid pair, no h2o"
        );
    }

    function _changeLiquiditiyPair(address _routerAddress, address _pair)
        private
    {
        _onBeforeNewRouter(routerAddress);

        routerAddress = _routerAddress;
        router = IUniswapV2Router02(routerAddress);
        pair = _pair;
        _validatePair();

        _onNewRouter(routerAddress, pair);
    }
    
    function _retrieveH2OTokens(uint256 amount) private {
        IERC20(_h2oAddress).safeTransfer(_h2oAddress, amount);
    }
}
