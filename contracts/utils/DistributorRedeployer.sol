// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../H2O.sol";
import "../interfaces/IUniswapV2Router02.sol";

contract DistributorRedeployer is Ownable {
    address constant FINN_ADDRESS = 0x9A92B5EBf1F6F6f7d93696FCD44e5Cf75035A756;
    address constant RKITTY_ADDRESS =
        0xC2b0435276139731d82Ae2Fa8928c9b9De0761c1;
    address constant H2O_ADDRESS = 0xDC151BC48a5F77288cdE9DdbFf2e32e6bcF4791F;

    bool done = false;

    function redeploy() external onlyOwner {
        require(!done, "already done");

        IUniswapV2Router02 router = IUniswapV2Router02(
            0x2d4e873f9Ab279da9f1bb2c532d4F06f67755b77
        );

        address native = router.WETH();

        address[] memory toNativePath = new address[](3);
        toNativePath[0] = RKITTY_ADDRESS;
        toNativePath[1] = FINN_ADDRESS;
        toNativePath[2] = native;

        address[] memory fromNativePath = new address[](3);
        fromNativePath[0] = native;
        fromNativePath[1] = FINN_ADDRESS;
        fromNativePath[2] = RKITTY_ADDRESS;

        H2O h2o = H2O(payable(H2O_ADDRESS));
        h2o.setup(RKITTY_ADDRESS, toNativePath, fromNativePath);

        done = true;
    }

    function configureDividendExempts(address[] memory holders)
        external
        onlyOwner
    {
        H2O h2o = H2O(payable(H2O_ADDRESS));
        for (uint256 i = 0; i < holders.length; i++) {
            h2o.setIsDividendExempt(holders[i], false);
        }
    }

    function transferH2OOwnership() external onlyOwner {
        H2O h2o = H2O(payable(H2O_ADDRESS));
        h2o.transferOwnership(owner());
    }
}
