// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/TokenTimelock.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./Airdrop.sol";
import "./H2O.sol";
import "./LPMigrator.sol";
import "./interfaces/IUniswapV2Router02.sol";

contract Factory {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    H2O public token;
    LPMigrator public migrator;
    Airdrop public airdrop;

    address public timelockAddress1;
    address public timelockAddress2;
    address public timelockAddress3;
    address public timelockAddress4;

    uint256 public constant MIGRATOR_APPROVAL_DELAY = 1 weeks;
    uint256 public constant TEAM_TOKENS_PART_LOCK = 4 weeks;

    constructor(
        address _routerAddress,
        address _tokenBAddress,
        address _multisigAddress,
        address _reflectTokenAddress,
        address[] memory _tokenBToNativeRoute,
        address[] memory _nativeToTokenBRoute
    ) payable {
        token = new H2O(_routerAddress, _tokenBAddress);

        _configureToken(_routerAddress, _reflectTokenAddress);

        uint256 bal = token.balanceOf(address(this));
        require(bal > 0, "!no tokens");

        uint256 liquidityAmount = bal.mul(20).div(100);
        uint256 airdropAmount = bal.mul(75).div(100);
        uint256 teamAmount = bal.sub(liquidityAmount).sub(airdropAmount);

        migrator = new LPMigrator(
            address(token),
            _routerAddress,
            MIGRATOR_APPROVAL_DELAY
        );
        // token.setIsDividendExempt(address(migrator), true);
        // token.setIsFeeExempt(address(migrator), true);
        // token.setIsWalletLimitExempt(address(migrator), true);
        // IERC20(address(token)).safeTransfer(address(migrator), liquidityAmount);
        // migrator.initializeLiquidity{value: msg.value}(
        //     _tokenBAddress,
        //     _tokenBToNativeRoute,
        //     _nativeToTokenBRoute
        // );

        // migrator.transferOwnership(_multisigAddress);

        // airdrop = new Airdrop(token, 1 weeks);
        // // wait with changing ownership after it's configured
        // airdrop.transferOwnership(msg.sender);
        // token.setIsDividendExempt(address(airdrop), true);
        // token.setIsFeeExempt(address(airdrop), true);
        // token.setIsWalletLimitExempt(address(airdrop), true);
        // IERC20(address(token)).safeTransfer(address(airdrop), airdropAmount);

        // _handleTeamTokens(teamAmount, _multisigAddress);
    }

    function _configureToken(
        address _routerAddress,
        address _reflectTokenAddress
    ) internal {
        address native = IUniswapV2Router02(_routerAddress).WETH();
        address[] memory toNativeRoute = new address[](2);
        toNativeRoute[0] = _reflectTokenAddress;
        toNativeRoute[1] = native;
        address[] memory fromNativeRoute = new address[](2);
        fromNativeRoute[0] = native;
        fromNativeRoute[1] = _reflectTokenAddress;
        token.setup(_reflectTokenAddress, toNativeRoute, fromNativeRoute);
    }

    function _handleTeamTokens(uint256 amount, address _multisigAddress) internal {
        uint256 partAmount = amount.div(5);
        IERC20(address(token)).safeTransfer(_multisigAddress, partAmount);

        timelockAddress1 = _createTimelock(
            partAmount,
            block.timestamp + TEAM_TOKENS_PART_LOCK,
            _multisigAddress
        );
        token.setIsDividendExempt(address(timelockAddress1), true);
        token.setIsFeeExempt(address(timelockAddress1), true);
        token.setIsWalletLimitExempt(address(timelockAddress1), true);

        timelockAddress2 = _createTimelock(
            partAmount,
            block.timestamp + TEAM_TOKENS_PART_LOCK * 2,
            _multisigAddress
        );
        token.setIsDividendExempt(address(timelockAddress2), true);
        token.setIsFeeExempt(address(timelockAddress2), true);
        token.setIsWalletLimitExempt(address(timelockAddress2), true);

        timelockAddress3 = _createTimelock(
            partAmount,
            block.timestamp + TEAM_TOKENS_PART_LOCK * 3,
            _multisigAddress
        );
        token.setIsDividendExempt(address(timelockAddress3), true);
        token.setIsFeeExempt(address(timelockAddress3), true);
        token.setIsWalletLimitExempt(address(timelockAddress3), true);

        timelockAddress4 = _createTimelock(
            partAmount,
            block.timestamp + TEAM_TOKENS_PART_LOCK * 4,
            _multisigAddress
        );
        token.setIsDividendExempt(address(timelockAddress4), true);
        token.setIsFeeExempt(address(timelockAddress4), true);
        token.setIsWalletLimitExempt(address(timelockAddress4), true);
    }

    function _createTimelock(
        uint256 _partAmount,
        uint256 _releaseTime,
        address _multisigAddress
    ) internal returns (address) {
        TokenTimelock timelock = new TokenTimelock(
            token,
            _multisigAddress,
            _releaseTime
        );
        IERC20(address(token)).safeTransfer(address(timelock), _partAmount);
        return address(timelock);
    }
}
