// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./interfaces/IH2OLiquidityPlugin.sol";
import "./interfaces/IH2ODistributorPlugin.sol";
import "./interfaces/IPairChange.sol";
import "./plugins/H2OPluginManager.sol";
import "./utils/UtilsLibrary.sol";

// import "hardhat/console.sol";

contract H2Ov2 is ERC20, IPairChange, H2OPluginManager {
    using SafeMath for uint256;

    mapping(address => bool) public isFeeExempt;
    mapping(address => bool) public isWalletLimitExempt;
    mapping(address => bool) public isDividendExempt;

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address constant ZERO = 0x0000000000000000000000000000000000000000;

    address public pair;

    uint256 public liquidityFeeOfTotal = 2000;
    uint256 public reflectionFeeOfTotal = 8000;
    uint256 public buyTotalFee = 500;
    uint256 public sellTotalFee = 1000;
    uint256 public constant feeDenominator = 10000;

    uint256 public maxWalletSize;

    bool public dividendNeedToUpdateHolders = false;

    // 0 means that auto distribution is disabled
    uint256 public autoDistributorGas = 0;
    // 0 means that auto swap is disabled
    uint256 public autoSwapThreshold = 0;

    bool private isSwapping = false;
    bool private isSwappingBack = false;
    bool private isProcessing = false;

    constructor(uint256 _approvalDelay)
        ERC20("H2O v2", "H2O")
        H2OPluginManager(_approvalDelay)
    {
        _mint(_msgSender(), 10**(9 + decimals()));
        maxWalletSize = (totalSupply() * 1) / 100;
        isFeeExempt[_msgSender()] = true;
        isWalletLimitExempt[_msgSender()] = true;
        isWalletLimitExempt[address(this)] = true;
        isDividendExempt[DEAD] = true;
        isDividendExempt[ZERO] = true;
        isDividendExempt[address(this)] = true;
    }

    function onPluginUpgraded(uint8 pluginId, bool isUpgrade)
        internal
        override
    {
        address pluginAddress = plugin(pluginId);
        _approve(address(this), pluginAddress, type(uint256).max);
        isFeeExempt[pluginAddress] = true;
        isWalletLimitExempt[pluginAddress] = true;
        isDividendExempt[pluginAddress] = true;

        if (pluginId == LIQUIDITY_PLUGIN_ID) {
            onPairChange();
        } else if (pluginId == DISTRIBUTOR_PLUGIN_ID) {
            if (isUpgrade) {
                dividendNeedToUpdateHolders = true;
            }
        }
    }

    function onPairChange() public override {
        pair = _liquidityPlugin().pair();
        isWalletLimitExempt[pair] = true;
        isDividendExempt[pair] = true;
    }

    function setAutoDistributorSettings(uint256 gas) external onlyOwner {
        require(gas < 750000);
        autoDistributorGas = gas;
    }

    function setIsFeeExempt(address holder, bool exempt) external onlyOwner {
        isFeeExempt[holder] = exempt;
    }

    function setIsDividendExempt(address holder, bool exempt)
        external
        onlyOwner
    {
        _setIsDividendExempt(holder, exempt);
    }

    function setIsWalletLimitExempt(address holder, bool exempt)
        external
        onlyOwner
    {
        isWalletLimitExempt[holder] = exempt;
    }

    function setMaxWallet(uint256 numerator, uint256 divisor)
        external
        onlyOwner
    {
        require(numerator > 0 && divisor > 0 && divisor <= 10000);
        maxWalletSize = (totalSupply() * numerator) / divisor;
    }

    function setAutoSwapThreshold(uint256 _autoSwapThreshold)
        external
        onlyOwner
    {
        require(
            _autoSwapThreshold <= totalSupply(),
            "Invalid autoswap threshold"
        );
        autoSwapThreshold = _autoSwapThreshold;
    }

    function shouldTakeFee(address sender) internal view returns (bool) {
        return !isFeeExempt[sender];
    }

    function swapBackAll() public {
        swapBack(balanceOf(address(this)));
    }

    function swapBack(uint256 amount) public {
        require(
            !dividendNeedToUpdateHolders,
            "Need to update holders to swapback"
        );
        if (amount == 0) {
            return;
        }
        isSwappingBack = true;

        uint256 amountToLiquify = amount.mul(liquidityFeeOfTotal).div(
            feeDenominator
        );
        try _liquidityPlugin().addLiquidity(amountToLiquify) {} catch (
            bytes memory reason
        ) {
            emit UtilsLibrary.ErrorLog(reason);
        }

        uint256 amountToSwap = amount - amountToLiquify;

        try _distributorPlugin().deposit(amountToSwap) {} catch (
            bytes memory reason
        ) {
            emit UtilsLibrary.ErrorLog(reason);
        }

        isSwappingBack = false;
    }

    function configureDividendHolders(
        address[] memory holders,
        bool updatingFinished
    ) external onlyOwner {
        for (uint256 i = 0; i < holders.length; i++) {
            _setIsDividendExempt(holders[i], false);
        }
        if (updatingFinished) {
            dividendNeedToUpdateHolders = false;
        }
    }

    function setFees(
        uint256 _liquidityFeeOfTotal,
        uint256 _reflectionFeeOfTotal,
        uint256 _buyTotalFee,
        uint256 _sellTotalFee
    ) external onlyOwner {
        liquidityFeeOfTotal = _liquidityFeeOfTotal;
        reflectionFeeOfTotal = _reflectionFeeOfTotal;
        buyTotalFee = _buyTotalFee;
        sellTotalFee = _sellTotalFee;
        require(buyTotalFee < feeDenominator.div(5));
        require(sellTotalFee < feeDenominator.div(5));
    }

    function process(uint256 gas, bool finishWhenIterationFinished)
        public
        returns (bool iterationFinished)
    {
        isProcessing = true;
        try
            _distributorPlugin().process(gas, finishWhenIterationFinished)
        returns (bool finished) {
            isProcessing = false;
            return finished;
        } catch (bytes memory reason) {
            isProcessing = false;
            emit UtilsLibrary.ErrorLog(reason);
        }
        return false;
    }

    function claimDividend(address shareholder) external {
        isProcessing = true;
        _distributorPlugin().claimDividend(shareholder);
        isProcessing = false;
    }

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        if (amount == 0 || isSwapping || isSwappingBack || isProcessing) {
            super._transfer(from, to, amount);
            _checkWalletLimit(to);
            return;
        }

        if (_shouldSwapBack(to)) {
            swapBackAll();
        }

        isSwapping = true;

        bool isSelling = to == pair;

        uint256 amountReceived = shouldTakeFee(from)
            ? _takeFee(isSelling, from, amount)
            : amount;
        super._transfer(from, to, amountReceived);

        isSwapping = false;

        _checkWalletLimit(to);

        _setShares(from, to);

        if (autoDistributorGas > 0 && !dividendNeedToUpdateHolders) {
            process(autoDistributorGas, false);
        }
    }

    function _setShares(address from, address to) private {
        isProcessing = true;
        if (!isDividendExempt[from]) {
            try _distributorPlugin().setShare(from, balanceOf(from)) {} catch (
                bytes memory reason
            ) {
                emit UtilsLibrary.ErrorLog(reason);
            }
        }
        if (!isDividendExempt[to]) {
            try _distributorPlugin().setShare(to, balanceOf(to)) {} catch (
                bytes memory reason
            ) {
                emit UtilsLibrary.ErrorLog(reason);
            }
        }
        isProcessing = false;
    }

    function _shouldTakeFee(address from) internal view returns (bool) {
        return !isFeeExempt[from];
    }

    function _takeFee(
        bool selling,
        address sender,
        uint256 amount
    ) internal returns (uint256) {
        uint256 feeAmount = (amount * _getTotalFee(selling)) / feeDenominator;

        super._transfer(sender, address(this), feeAmount);

        return amount - feeAmount;
    }

    function _getTotalFee(bool selling) public view returns (uint256) {
        if (selling) {
            return sellTotalFee;
        } else {
            return buyTotalFee;
        }
    }

    function _liquidityPlugin()
        private
        view
        returns (IH2OLiquidityPlugin result)
    {
        result = IH2OLiquidityPlugin(plugin(LIQUIDITY_PLUGIN_ID));
    }

    function _distributorPlugin()
        private
        view
        returns (IH2ODistributorPlugin result)
    {
        result = IH2ODistributorPlugin(plugin(DISTRIBUTOR_PLUGIN_ID));
    }

    function _shouldSwapBack(address to) internal view returns (bool) {
        return
            _msgSender() != pair &&
            !isSwapping &&
            autoSwapThreshold > 0 &&
            to == pair &&
            balanceOf(address(this)) >= autoSwapThreshold;
    }

    function _checkWalletLimit(address _address) private view {
        if (
            isWalletLimitExempt[_address] ||
            _address == pair ||
            _address == DEAD
        ) {
            return;
        }

        require(
            balanceOf(_address) <= maxWalletSize,
            "Transfer amount exceeds the bag size."
        );
    }

    function _setIsDividendExempt(address holder, bool exempt) private {
        require(holder != address(this) && holder != pair);
        isDividendExempt[holder] = exempt;
        isProcessing = true;
        if (exempt) {
            _distributorPlugin().setShare(holder, 0);
        } else {
            _distributorPlugin().setShare(holder, balanceOf(holder));
        }
        isProcessing = false;
    }
}
