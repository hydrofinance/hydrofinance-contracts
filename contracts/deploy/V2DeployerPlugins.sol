// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../plugins/H2OLiquidityPlugin.sol";
import "../plugins/H2ODistributorPlugin.sol";
import "../H2Ov2.sol";
import "./V2Deployer.sol";

contract V2DeployerPlugins is Ownable {
    address tokenAddress;

    address public liqPluginAddress;
    address payable public distPluginAddress;

    address huckleRouterAddress;
    address finnAddress;

    constructor(
        address _tokenAddress,
        address _huckleRouterAddress,
        address _finnAddress
    ) {
        tokenAddress = _tokenAddress;
        huckleRouterAddress = _huckleRouterAddress;
        finnAddress = _finnAddress;
    }

    function setupLiquidityPlugin() external onlyOwner {
        H2OLiquidityPlugin liqPlugin = new H2OLiquidityPlugin(tokenAddress);
        liqPluginAddress = address(liqPlugin);

        IUniswapV2Factory factory = IUniswapV2Factory(
            IUniswapV2Router02(huckleRouterAddress).factory()
        );
        address pairAddress = factory.getPair(tokenAddress, finnAddress);
        if (pairAddress == address(0)) {
            pairAddress = factory.createPair(tokenAddress, finnAddress);
        }

        liqPlugin.setupLiquiditiyPair(huckleRouterAddress, pairAddress);
        H2Ov2(tokenAddress).setupPlugin(1, address(liqPlugin));
    }

    function setupDistributorPlugin() external onlyOwner {
        H2ODistributorPlugin distPlugin = new H2ODistributorPlugin(
            tokenAddress
        );
        distPluginAddress = payable(address(distPlugin));

        address native = IUniswapV2Router02(huckleRouterAddress).WETH();

        address[] memory h2oToNative = new address[](3);
        h2oToNative[0] = tokenAddress;
        h2oToNative[1] = finnAddress;
        h2oToNative[2] = native;
        address[] memory nativeToH2o = new address[](3);
        nativeToH2o[0] = native;
        nativeToH2o[1] = finnAddress;
        nativeToH2o[2] = tokenAddress;
        distPlugin.setupBaseRouter(
            huckleRouterAddress,
            h2oToNative,
            nativeToH2o
        );

        address[] memory h2oToReward = new address[](1);
        h2oToReward[0] = tokenAddress;
        address[] memory rewardToNative = new address[](3);
        rewardToNative[0] = tokenAddress;
        rewardToNative[1] = finnAddress;
        rewardToNative[2] = native;
        address[] memory nativeToReward = new address[](3);
        rewardToNative[0] = native;
        rewardToNative[1] = finnAddress;
        rewardToNative[2] = tokenAddress;
        distPlugin.setupRewardToken(
            tokenAddress,
            huckleRouterAddress,
            h2oToReward,
            rewardToNative,
            nativeToReward
        );
        H2Ov2(tokenAddress).setupPlugin(2, address(distPlugin));
    }

    function transferOwnershipsBack() external onlyOwner {
        try H2Ov2(tokenAddress).transferOwnership(owner()) {} catch {}
        try
            H2OLiquidityPlugin(liqPluginAddress).transferOwnership(owner())
        {} catch {}
        try
            H2ODistributorPlugin(distPluginAddress).transferOwnership(owner())
        {} catch {}
    }

    function inCaseOfTokensStuck(address _tokenAddress) external onlyOwner {
        IERC20(_tokenAddress).transfer(
            owner(),
            IERC20(_tokenAddress).balanceOf(address(this))
        );
    }
}
