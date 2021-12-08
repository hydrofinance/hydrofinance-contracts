// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./DividendDistributor.sol";
import "./TransferHelper.sol";

// import "hardhat/console.sol";

contract H2O is IERC20, Ownable, TransferHelper {
    using Address for address;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address DEAD = 0x000000000000000000000000000000000000dEaD;
    address ZERO = 0x0000000000000000000000000000000000000000;

    string _name = "H2O";
    string _symbol = "H2O";
    uint8 constant _decimals = 18;

    uint256 _totalSupply = 1e9 * (10**_decimals);
    uint256 public _maxWalletSize = (_totalSupply * 1) / 100;

    mapping(address => uint256) _balances;
    mapping(address => mapping(address => uint256)) _allowances;

    mapping(address => bool) isFeeExempt;
    mapping(address => bool) isWalletLimitExempt;
    mapping(address => bool) isDividendExempt;

    // Buy Tax 5% (1%Liquidity, 4%Rewards)
    // Sell Tax 10% (2% Liquidity, 8% Rewards)

    uint256 liquidityFeeOfTotal = 200;
    uint256 reflectionFeeOfTotal = 800;
    uint256 feeOfTotalDenominator = 1000;
    uint256 buyTotalFee = 500;
    uint256 sellTotalFee = 1000;
    uint256 feeDenominator = 10000;

    uint256 targetLiquidity = 35;
    uint256 targetLiquidityDenominator = 100;

    DividendDistributor distributor;
    uint256 distributorGas = 500000;

    bool public swapEnabled = true;
    uint256 public swapThreshold = _totalSupply / 2000;
    bool inSwap;
    modifier swapping() {
        inSwap = true;
        _;
        inSwap = false;
    }

    constructor(address _routerAddress, address _tokenB)
        TransferHelper(_routerAddress, _tokenB)
    {
        isFeeExempt[msg.sender] = true;
        isWalletLimitExempt[address(this)] = true;
        isWalletLimitExempt[msg.sender] = true;
        isWalletLimitExempt[routerAddress] = true;
        isWalletLimitExempt[pair] = true;
        isDividendExempt[pair] = true;
        isDividendExempt[address(this)] = true;
        isDividendExempt[DEAD] = true;
        isDividendExempt[ZERO] = true;

        _balances[msg.sender] = _totalSupply;
        emit Transfer(address(0), msg.sender, _totalSupply);
    }

    receive() external payable {}

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function decimals() external pure returns (uint8) {
        return _decimals;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function getOwner() external view returns (address) {
        return owner();
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }

    function increaseAllowance(address spender, uint256 addedValue)
        public
        virtual
        returns (bool)
    {
        _approve(
            msg.sender,
            spender,
            _allowances[msg.sender][spender] + addedValue
        );
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue)
        public
        virtual
        returns (bool)
    {
        uint256 currentAllowance = _allowances[msg.sender][spender];
        require(
            currentAllowance >= subtractedValue,
            "ERC20: decreased allowance below zero"
        );
        unchecked {
            _approve(msg.sender, spender, currentAllowance - subtractedValue);
        }

        return true;
    }

    function allowance(address holder, address spender)
        external
        view
        override
        returns (uint256)
    {
        return _allowances[holder][spender];
    }

    function approve(address spender, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function transfer(address recipient, uint256 amount)
        external
        override
        returns (bool)
    {
        return _transferFrom(msg.sender, recipient, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external override returns (bool) {
        _transferFrom(sender, recipient, amount);

        uint256 currentAllowance = _allowances[sender][msg.sender];
        require(
            currentAllowance >= amount,
            "ERC20: transfer amount exceeds allowance"
        );
        unchecked {
            _approve(sender, msg.sender, currentAllowance - amount);
        }

        return true;
    }

    function _transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) internal returns (bool) {
        require(_balances[sender] >= amount, "Insufficient balance");
        if (inSwap) {
            return _basicTransfer(sender, recipient, amount);
        }

        bool selling = recipient == pair;

        if (recipient != pair && recipient != DEAD) {
            if (!isWalletLimitExempt[recipient])
                checkWalletLimit(recipient, amount);
        }

        unchecked {
            _balances[sender] = _balances[sender] - amount;
        }

        uint256 amountReceived = shouldTakeFee(sender)
            ? takeFee(selling, sender, amount)
            : amount;

        if (shouldSwapBack(recipient)) {
            swapBack(amount);
        }

        _balances[recipient] = _balances[recipient] + amountReceived;

        if (!isDividendExempt[sender]) {
            try distributor.setShare(sender, _balances[sender]) {} catch {}
        }
        if (!isDividendExempt[recipient]) {
            try
                distributor.setShare(recipient, _balances[recipient])
            {} catch {}
        }

        try distributor.process(distributorGas) {} catch {}

        emit Transfer(sender, recipient, amountReceived);
        return true;
    }

    function _basicTransfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal returns (bool) {
        unchecked {
            _balances[sender] = _balances[sender] - amount;
        }
        _balances[recipient] = _balances[recipient] + amount;
        emit Transfer(sender, recipient, amount);
        return true;
    }

    function checkWalletLimit(address recipient, uint256 amount) internal view {
        require(
            _balances[recipient] + amount <= _maxWalletSize,
            "Transfer amount exceeds the bag size."
        );
    }

    function setup(
        address reflectToken,
        address[] memory _toNativeRoute,
        address[] memory _fromNativeRoute
    ) external onlyOwner {
        distributor = new DividendDistributor(
            routerAddress,
            reflectToken,
            _toNativeRoute,
            _fromNativeRoute
        );
    }

    function shouldTakeFee(address sender) internal view returns (bool) {
        return !isFeeExempt[sender];
    }

    function getTotalFee(bool selling) public view returns (uint256) {
        if (selling) {
            return sellTotalFee;
        }
        return buyTotalFee;
    }

    function takeFee(
        bool selling,
        address sender,
        uint256 amount
    ) internal returns (uint256) {
        uint256 feeAmount = (amount * getTotalFee(selling)) / feeDenominator;
        _balances[address(this)] = _balances[address(this)] + feeAmount;
        emit Transfer(sender, address(this), feeAmount);

        return amount - feeAmount;
    }

    function shouldSwapBack(address recipient) internal view returns (bool) {
        return
            msg.sender != pair &&
            !inSwap &&
            swapEnabled &&
            recipient == pair &&
            _balances[address(this)] >= swapThreshold;
    }

    function swapBack(uint256 amount) internal swapping {
        uint256 swapHolderProtection = amount;

        if (_balances[address(this)] < swapHolderProtection)
            swapHolderProtection = _balances[address(this)];

        uint256 dynamicLiquidityFeeOfTotal = isOverLiquified(
            targetLiquidity,
            targetLiquidityDenominator
        )
            ? 0
            : liquidityFeeOfTotal;

        uint256 amountToLiquify = swapHolderProtection
            .mul(dynamicLiquidityFeeOfTotal)
            .div(feeOfTotalDenominator)
            .div(2);

        uint256 amountToSwap = swapHolderProtection - amountToLiquify;

        uint256 amountMOVR = swapToMOVR(amountToSwap);

        uint256 amountMOVRLiquidity = amountMOVR
            .mul(dynamicLiquidityFeeOfTotal)
            .div(feeOfTotalDenominator)
            .div(2);
        uint256 amountMOVRReflection = amountMOVR.mul(reflectionFeeOfTotal).div(
            feeOfTotalDenominator
        );

        try distributor.deposit{value: amountMOVRReflection}() {} catch {}

        if (amountToLiquify > 0) {
            addLiquidity(amountMOVRLiquidity, amountToLiquify);
        }
    }

    function triggerManualBuyback(uint256 amount) external onlyOwner {
        _buyTokens(amount, DEAD);
    }

    function triggerManualBuybackFromToken(
        uint256 amount,
        address token,
        address[] memory route
    ) external onlyOwner {
        _buyTokensFromToken(amount, DEAD, token, route);
    }

    function _buyTokens(uint256 amount, address to) internal swapping {
        buyTokens(amount, to);
    }

    function _buyTokensFromToken(
        uint256 amount,
        address to,
        address token,
        address[] memory route
    ) internal swapping {
        buyTokensFromToken(amount, to, token, route);
    }

    function manualTokenPurchase(uint256 amount) external onlyOwner {
        try distributor.deposit{value: amount}() {} catch {}
    }

    function setReflectToken(
        address newToken,
        address[] memory toNativeRoute,
        address[] memory fromNativeRoute,
        address router,
        bool forceChange
    ) external onlyOwner {
        require(newToken.isContract(), "Enter valid contract address");
        distributor.changeToken(
            newToken,
            toNativeRoute,
            fromNativeRoute,
            router,
            forceChange
        );
    }

    function checkReflectTokenUpdate()
        external
        view
        onlyOwner
        returns (uint256 count, uint256 progress)
    {
        return distributor.checkTokenChangeProgress();
    }

    function setMaxWallet(uint256 numerator, uint256 divisor)
        external
        onlyOwner
    {
        require(numerator > 0 && divisor > 0 && divisor <= 10000);
        _maxWalletSize = (_totalSupply * numerator) / divisor;
    }

    function setIsDividendExempt(address holder, bool exempt)
        external
        onlyOwner
    {
        require(holder != address(this) && holder != pair);
        isDividendExempt[holder] = exempt;
        if (exempt) {
            distributor.setShare(holder, 0);
        } else {
            distributor.setShare(holder, _balances[holder]);
        }
    }

    function setIsFeeExempt(address holder, bool exempt) external onlyOwner {
        isFeeExempt[holder] = exempt;
    }

    function setIsWalletLimitExempt(address holder, bool exempt)
        external
        onlyOwner
    {
        isWalletLimitExempt[holder] = exempt;
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

    function setSwapBackSettings(bool _enabled, uint256 _denominator)
        external
        onlyOwner
    {
        require(_denominator > 0);
        swapEnabled = _enabled;
        swapThreshold = _totalSupply / _denominator;
    }

    function setTargetLiquidity(uint256 _target, uint256 _denominator)
        external
        onlyOwner
    {
        targetLiquidity = _target;
        targetLiquidityDenominator = _denominator;
    }

    function setDistributionCriteria(
        uint256 _minPeriod,
        uint256 _minDistribution
    ) external onlyOwner {
        distributor.setDistributionCriteria(_minPeriod, _minDistribution);
    }

    function setDistributorSettings(uint256 gas) external onlyOwner {
        require(gas < 750000);
        distributorGas = gas;
    }

    function getCirculatingSupply() public view returns (uint256) {
        return _totalSupply - (balanceOf(DEAD) + balanceOf(ZERO));
    }

    function getLiquidityBacking(uint256 accuracy)
        public
        view
        returns (uint256)
    {
        return (accuracy * balanceOf(pair) * 2) / getCirculatingSupply();
    }

    function isOverLiquified(uint256 target, uint256 accuracy)
        public
        view
        returns (bool)
    {
        return getLiquidityBacking(accuracy) > target;
    }

    function availableDividends(address account)
        external
        view
        returns (uint256)
    {
        return distributor.checkUnpaidDividends(account);
    }

    function claimDividends() external {
        distributor.claimDividend(msg.sender);
        try distributor.process(distributorGas) {} catch {}
    }

    function processDividends() external {
        try distributor.process(distributorGas) {} catch {}
    }

    function onNewRouter(address _routerAddress, address _pair) internal override {
        super.onNewRouter(_routerAddress, _pair);
        _approve(msg.sender, _routerAddress, 0);
        _approve(msg.sender, _routerAddress, type(uint256).max);
        _approve(address(this), _routerAddress, 0);
        _approve(address(this), _routerAddress, type(uint256).max);

        isWalletLimitExempt[_routerAddress] = true;
        isWalletLimitExempt[_pair] = true;
        isDividendExempt[_pair] = true;
    }

    function onBeforeNewRouter(address _routerAddress) internal override {
        super.onBeforeNewRouter(_routerAddress);
        _approve(msg.sender, _routerAddress, 0);
        _approve(address(this), _routerAddress, 0);
    }

    function currentlyServing() public view returns (address token) {
        return distributor.token();
    }
}
