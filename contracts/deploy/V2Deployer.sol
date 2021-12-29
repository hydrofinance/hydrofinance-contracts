// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../H2Ov2.sol";
import "../utils/LPMigrator.sol";
import "../utils/V2Migrator.sol";
import "../plugins/H2OLiquidityPlugin.sol";
import "../plugins/H2ODistributorPlugin.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/IUniswapV2Factory.sol";

contract V2Deployer is Ownable {
    address payable oldTokenAddress;
    address public tokenAddress;
    address public v2migratorAddress;
    address public lpMigratorAddress;
    address huckleRouterAddress;
    address finnAddress;
    address rkittyAddress;

    uint256 public constant MIGRATOR_APPROVAL_DELAY = 1 weeks;
    uint256 public constant H2O_APPROVAL_DELAY = 4 hours;

    constructor(
        address payable _oldToken,
        address _huckleRouterAddress,
        address _finnAddress,
        address _rkittyAddress
    ) {
        oldTokenAddress = _oldToken;
        huckleRouterAddress = _huckleRouterAddress;
        finnAddress = _finnAddress;
        rkittyAddress = _rkittyAddress;

        H2Ov2 token = new H2Ov2(H2O_APPROVAL_DELAY);
        tokenAddress = address(token);

        uint256 bal = token.balanceOf(address(this));
        require(bal > 0, "!no tokens");

        // we are turning of fees while migrating token to v2
        token.setFees(0, 0, 0, 0);
    }

    function configureOldToken() external onlyOwner {
        H2O oldToken = H2O(oldTokenAddress);
        require(
            address(this) == oldToken.owner(),
            "Need to be old token owner"
        );
        oldToken.setIsFeeExempt(address(this), true);
        oldToken.setIsWalletLimitExempt(address(this), true);
        oldToken.setIsDividendExempt(address(this), true);

        oldToken.setIsFeeExempt(owner(), true);
        oldToken.setIsWalletLimitExempt(owner(), true);

        oldToken.setFees(0, 0, 0, 0);
    }

    function setupV2Migrator(uint256 _oldAmount) external onlyOwner {
        H2O oldToken = H2O(oldTokenAddress);
        H2Ov2 token = H2Ov2(tokenAddress);
        require(
            address(this) == oldToken.owner(),
            "Need to be old token owner"
        );
        require(_oldAmount > 0, "!_oldAmount");

        H2O(oldTokenAddress).transferFrom(
            _msgSender(),
            address(this),
            _oldAmount
        );

        V2Migrator v2migrator = new V2Migrator(oldTokenAddress, tokenAddress);
        v2migrator.transferOwnership(_msgSender());
        v2migratorAddress = address(v2migrator);
        
        oldToken.setIsFeeExempt(v2migratorAddress, true);
        oldToken.setIsWalletLimitExempt(v2migratorAddress, true);
        oldToken.setIsDividendExempt(v2migratorAddress, true);
        token.setIsWalletLimitExempt(v2migratorAddress, true);
        token.setIsFeeExempt(v2migratorAddress, true);
        token.setIsDividendExempt(v2migratorAddress, true);

        token.transfer(
            v2migratorAddress,
            H2Ov2(tokenAddress).balanceOf(address(this))
        );

        H2O(oldTokenAddress).approve(address(v2migrator), _oldAmount);
        v2migrator.migrate(_oldAmount);
    }

    function setupLPMigrator() external payable onlyOwner {
        H2Ov2 token = H2Ov2(tokenAddress);
        require(address(this) == token.owner(), "Need to be token owner");

        address native = IUniswapV2Router02(huckleRouterAddress).WETH();

        uint256 tokenBal = token.balanceOf(address(this));
        require(tokenBal > 0, "!incorrect bal");

        LPMigrator lpMigrator = new LPMigrator(
            address(token),
            huckleRouterAddress,
            MIGRATOR_APPROVAL_DELAY
        );
        lpMigratorAddress = address(lpMigrator);
        token.setIsFeeExempt(address(lpMigrator), true);
        token.setIsDividendExempt(address(lpMigrator), true);
        token.setIsWalletLimitExempt(address(lpMigrator), true);

        token.transfer(address(lpMigrator), tokenBal);

        address[] memory tokenBToNative = new address[](2);
        tokenBToNative[0] = finnAddress;
        tokenBToNative[1] = native;
        address[] memory nativeToTokenB = new address[](2);
        nativeToTokenB[0] = native;
        nativeToTokenB[1] = finnAddress;
        lpMigrator.initializeLiquidity{value: msg.value}(
            finnAddress,
            tokenBToNative,
            nativeToTokenB
        );

        lpMigrator.transferOwnership(owner());
    }

    function turnOnFees() external onlyOwner {
        H2Ov2(tokenAddress).setFees(2000, 8000, 500, 1000);
    }

    function transferH2Ov2OwnershipsBack() external onlyOwner {
        H2Ov2(tokenAddress).transferOwnership(owner());
    }

    function transferH2Ov1OwnershipsBack() external onlyOwner {
        H2O(oldTokenAddress).transferOwnership(owner());
    }

    function transferLpMigratorOwnershipsBack() external onlyOwner {
        LPMigrator(lpMigratorAddress).transferOwnership(owner());
    }

    function inCaseOfTokensStuck(address _tokenAddress) external onlyOwner {
        uint256 bal = IERC20(_tokenAddress).balanceOf(address(this));
        require(bal > 0, "!bal");

        IERC20(_tokenAddress).transfer(owner(), bal);
    }
}
