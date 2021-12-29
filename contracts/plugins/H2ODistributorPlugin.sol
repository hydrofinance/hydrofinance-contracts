// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IH2ODistributorPlugin.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/IWETH.sol";
import "../utils/SwapToH2O.sol";

// import "hardhat/console.sol";

contract H2ODistributorPlugin is IH2ODistributorPlugin, Ownable, SwapToH2O {
    address _h2oAddress;

    struct Share {
        uint256 amount;
        uint256 totalExcluded;
        uint256 totalRealised;
        uint256 lastConversionNumerator;
        uint256 lastConversionDivisor;
    }

    address public rewardTokenAddress;
    address public baseRouterAddress;
    address public rewardRouterAddress;
    address[] rewardToNativeRoute;
    address[] nativeToRewardRoute;
    address[] h2oToRewardTokenRoute;
    address[] h2oToNativeTokenRoute;
    address[] nativeToH2oTokenRoute;

    address[] shareholders;
    mapping(address => uint256) shareholderIndexes;
    mapping(address => uint256) shareholderClaims;

    mapping(address => Share) public shares;

    uint256 public totalShares;
    uint256 public totalDividends;
    uint256 public totalDistributed;
    uint256 public dividendsPerShare;
    uint256 constant dividendsPerShareAccuracyFactor = 10**36;
    uint256 public tokenConversionNumerator;
    uint256 public tokenConversionDivisor;
    uint256 public tokenConversionCount;
    uint256 public tokenConversionProgress;
    uint256 public h2oDepositThreshold = 10**23;

    uint256 public minPeriod = 1 hours;
    uint256 public minDistribution = 1 * (10**18);

    uint256 currentIndex;

    modifier onlyH2O() {
        require(_h2oAddress == _msgSender(), "Caller should be h2o contract");
        _;
    }

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

    function setH2ODepositThreshold(uint256 _h2oDepositThreshold)
        external
        onlyOwner
    {
        h2oDepositThreshold = _h2oDepositThreshold;
    }

    function setupBaseRouter(
        address _baseRouterAddress,
        address[] memory _h2oToNativeTokenRoute,
        address[] memory _nativeToH2oTokenRoute
    ) external onlyOwner {
        baseRouterAddress = _baseRouterAddress;
        h2oToNativeTokenRoute = _h2oToNativeTokenRoute;
        nativeToH2oTokenRoute = _nativeToH2oTokenRoute;
        IERC20(_h2oAddress).approve(_baseRouterAddress, type(uint256).max);
    }

    function setupRewardToken(
        address _rewardTokenAddress,
        address _rewardRouterAddress,
        address[] calldata _h2oToRewardTokenRoute,
        address[] calldata _rewardToNativeRoute,
        address[] calldata _nativeToRewardRoute
    ) external onlyOwner {
        require(
            baseRouterAddress != address(0),
            "Distributor not configured properly"
        );
        require(
            rewardTokenAddress == address(0),
            "Reward token already setup, use change"
        );
        rewardTokenAddress = _rewardTokenAddress;
        rewardRouterAddress = _rewardRouterAddress;
        rewardToNativeRoute = _rewardToNativeRoute;
        nativeToRewardRoute = _nativeToRewardRoute;
        h2oToRewardTokenRoute = _h2oToRewardTokenRoute;

        IERC20(_h2oAddress).approve(_rewardRouterAddress, type(uint256).max);
        IERC20(_rewardTokenAddress).approve(
            _rewardRouterAddress,
            type(uint256).max
        );
    }

    function changeRewardToken(
        address _rewardTokenAddress,
        address _rewardRouterAddress,
        address[] calldata _h2oToRewardTokenRoute,
        address[] calldata _rewardToNativeRoute,
        address[] calldata _nativeToRewardRoute,
        bool forceChange
    ) external onlyOwner {
        require(
            rewardTokenAddress != address(0) && baseRouterAddress != address(0),
            "Distributor not configured properly"
        );
        require(
            tokenConversionCount <= tokenConversionProgress || forceChange,
            "Previous conversion not complete."
        );
        tokenConversionDivisor = IERC20(rewardTokenAddress).balanceOf(
            address(this)
        );
        require(
            totalDividends == 0 || tokenConversionDivisor > 0,
            "Requires at least some of initial token to calculate convertion rate."
        );

        if (tokenConversionDivisor > 0) {
            IERC20(_rewardTokenAddress).approve(
                rewardRouterAddress,
                type(uint256).max
            );

            IUniswapV2Router02 rewardRouter = IUniswapV2Router02(
                rewardRouterAddress
            );
            if (rewardTokenAddress == rewardRouter.WETH()) {
                IWETH(rewardRouter.WETH()).withdraw(tokenConversionDivisor);
            } else {
                _rewardToNative(tokenConversionDivisor);
            }

            tokenConversionCount = shareholders.length;
            tokenConversionProgress = 0;
        }

        rewardTokenAddress = _rewardTokenAddress;
        rewardRouterAddress = _rewardRouterAddress;
        rewardToNativeRoute = _rewardToNativeRoute;
        nativeToRewardRoute = _nativeToRewardRoute;
        h2oToRewardTokenRoute = _h2oToRewardTokenRoute;

        IERC20(_h2oAddress).approve(_rewardRouterAddress, type(uint256).max);
        IERC20(_rewardTokenAddress).approve(
            _rewardRouterAddress,
            type(uint256).max
        );

        uint256 nativeBal = address(this).balance;

        if (nativeBal > 0) {
            IUniswapV2Router02 rewardRouter = IUniswapV2Router02(
                rewardRouterAddress
            );
            if (rewardTokenAddress == rewardRouter.WETH()) {
                IWETH(rewardRouter.WETH()).deposit{value: nativeBal}();
            } else {
                _nativeToReward(nativeBal);
            }
        }

        if (totalDividends > 0) {
            tokenConversionNumerator = IERC20(rewardTokenAddress).balanceOf(
                address(this)
            );

            totalDividends =
                (totalDividends * tokenConversionNumerator) /
                tokenConversionDivisor;
            dividendsPerShare =
                (dividendsPerShare * tokenConversionNumerator) /
                tokenConversionDivisor;
            totalDistributed =
                (totalDistributed * tokenConversionNumerator) /
                tokenConversionDivisor;
        }
    }

    function checkTokenChangeProgress()
        external
        view
        returns (uint256 count, uint256 progress)
    {
        return (tokenConversionCount, tokenConversionProgress);
    }

    function setDistributionCriteria(
        uint256 _minPeriod,
        uint256 _minDistribution
    ) external onlyH2OOrOwner {
        minPeriod = _minPeriod;
        minDistribution = _minDistribution;
    }

    function setShare(address shareholder, uint256 amount)
        external
        override
        onlyH2O
    {
        if (shares[shareholder].amount > 0) {
            if (
                shares[shareholder].lastConversionNumerator !=
                tokenConversionNumerator ||
                shares[shareholder].lastConversionDivisor !=
                tokenConversionDivisor
            ) {
                _processTokenChange(shareholder);
            }
            _distributeDividend(shareholder, getUnpaidEarnings(shareholder));
        }

        if (amount > 0 && shares[shareholder].amount == 0) {
            _addShareholder(shareholder);
        } else if (amount == 0 && shares[shareholder].amount > 0) {
            _removeShareholder(shareholder);
        }

        totalShares = (totalShares - shares[shareholder].amount) + amount;
        shares[shareholder].amount = amount;
        shares[shareholder].totalExcluded = _getCumulativeDividends(
            shares[shareholder].amount
        );
    }

    function deposit(uint256 amount) external override onlyH2OOrOwner {
        _transferH2OToSelf(amount, _msgSender());

        uint256 h2oAmount = _getH2OBalance();

        if (h2oAmount < h2oDepositThreshold) {
            return;
        }

        uint256 rewardAmount = 0;
        if (rewardTokenAddress == _h2oAddress) {
            // Do nothing, h2o as reward token
        } else if (rewardRouterAddress == baseRouterAddress) {
            IUniswapV2Router02(baseRouterAddress)
                .swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    h2oAmount,
                    1,
                    h2oToRewardTokenRoute,
                    address(this),
                    block.timestamp
                );
        } else {
            IUniswapV2Router02(baseRouterAddress)
                .swapExactTokensForETHSupportingFeeOnTransferTokens(
                    h2oAmount,
                    1,
                    h2oToNativeTokenRoute,
                    address(this),
                    block.timestamp
                );
            uint256 nativeAmount = address(this).balance;
            _nativeToReward(nativeAmount);
        }
        rewardAmount = IERC20(rewardTokenAddress).balanceOf(address(this));

        totalDividends = totalDividends + rewardAmount;
        dividendsPerShare =
            dividendsPerShare +
            ((dividendsPerShareAccuracyFactor * h2oAmount) / totalShares);
    }

    function process(uint256 gas, bool finishWhenIterationFinished)
        external
        override
        onlyH2O
        returns (bool iterationFinished)
    {
        uint256 shareholderCount = shareholders.length;

        if (shareholderCount == 0) {
            return false;
        }

        uint256 gasUsed = 0;
        uint256 gasLeft = gasleft();

        uint256 iterations = 0;

        while (gasUsed < gas && iterations < shareholderCount) {
            if (currentIndex >= shareholderCount) {
                currentIndex = 0;
                iterationFinished = true;
                if (finishWhenIterationFinished) {
                    return true;
                }
            }

            if (
                shares[shareholders[currentIndex]].lastConversionNumerator !=
                tokenConversionNumerator ||
                shares[shareholders[currentIndex]].lastConversionDivisor !=
                tokenConversionDivisor
            ) _processTokenChange(shareholders[currentIndex]);

            uint256 unpaidEarnings = getUnpaidEarnings(
                shareholders[currentIndex]
            );
            if (shouldDistribute(shareholders[currentIndex], unpaidEarnings)) {
                _distributeDividend(shareholders[currentIndex], unpaidEarnings);
            }

            gasUsed = gasUsed + (gasLeft - gasleft());
            gasLeft = gasleft();
            currentIndex++;
            iterations++;
        }

        return false;
    }

    function processTokenChangeForAllShareholders(uint256 gas)
        external
        onlyOwner
        returns (bool processFinished)
    {
        uint256 shareholderCount = shareholders.length;

        if (shareholderCount == 0) {
            return false;
        }

        uint256 gasUsed = 0;
        uint256 gasLeft = gasleft();

        uint256 iterations = 0;

        while (gasUsed < gas && iterations < shareholderCount) {
            if (
                shares[shareholders[iterations]].lastConversionNumerator !=
                tokenConversionNumerator ||
                shares[shareholders[iterations]].lastConversionDivisor !=
                tokenConversionDivisor
            ) _processTokenChange(shareholders[iterations]);

            gasUsed = gasUsed + (gasLeft - gasleft());
            gasLeft = gasleft();
            iterations++;
        }

        return iterations >= shareholderCount;
    }

    function hasDividendsToDistribute()
        external
        view
        returns (bool hasDividends)
    {
        uint256 shareholderCount = shareholders.length;

        if (shareholderCount == 0) {
            return false;
        }

        uint256 index = 0;

        while (index < shareholderCount) {
            uint256 unpaidEarnings = getUnpaidEarnings(shareholders[index]);
            if (shouldDistribute(shareholders[index], unpaidEarnings)) {
                return true;
            }
            index++;
        }

        return false;
    }

    function shouldDistribute(address shareholder, uint256 unpaidEarnings)
        internal
        view
        returns (bool)
    {
        return
            shareholderClaims[shareholder] + minPeriod < block.timestamp &&
            unpaidEarnings > minDistribution;
    }

    function claimDividend(address shareholder) external override onlyH2O {
        if (
            shares[shareholder].lastConversionNumerator !=
            tokenConversionNumerator ||
            shares[shareholder].lastConversionDivisor != tokenConversionDivisor
        ) {
            _processTokenChange(shareholder);
        }
        _distributeDividend(shareholder, getUnpaidEarnings(shareholder));
    }

    function getUnpaidEarnings(address shareholder)
        public
        view
        returns (uint256)
    {
        if (shares[shareholder].amount == 0) {
            return 0;
        }

        uint256 shareholderTotalDividends = _getCumulativeDividends(
            shares[shareholder].amount
        );
        uint256 shareholderTotalExcluded = shares[shareholder].totalExcluded;

        if (
            shares[shareholder].lastConversionNumerator !=
            tokenConversionNumerator ||
            shares[shareholder].lastConversionDivisor != tokenConversionDivisor
        ) {
            shareholderTotalDividends =
                (shareholderTotalDividends * tokenConversionNumerator) /
                tokenConversionDivisor;
            shareholderTotalExcluded =
                (shareholderTotalExcluded * tokenConversionNumerator) /
                tokenConversionDivisor;
        }

        if (shareholderTotalDividends <= shareholderTotalExcluded) {
            return 0;
        }

        return shareholderTotalDividends - shareholderTotalExcluded;
    }

    function checkUnpaidDividends(address shareholder)
        external
        view
        returns (uint256)
    {
        return getUnpaidEarnings(shareholder);
    }

    function retirePlugin() external override onlyH2OOrOwner {
        uint256 rewardBal = IERC20(rewardTokenAddress).balanceOf(address(this));
        if (rewardBal > 0 && rewardTokenAddress != _h2oAddress) {
            _rewardToNative(rewardBal);
            uint256 nativeBal = address(this).balance;
            if (nativeBal > 0) {
                _nativeToH2o(nativeBal);
            }
        }
        uint256 h2oBal = _getH2OBalance();
        if (h2oBal > 0) {
            _retrieveH2OTokens(h2oBal);
        }
    }

    function h2oAddress()
        public
        view
        override(IH2OPlugin, SwapToH2O)
        returns (address addr)
    {
        addr = _h2oAddress;
    }

    function rewardToNative(uint256 amount) external onlyOwner {
        _rewardToNative(amount);
    }

    function nativeToH2o(uint256 amount) external onlyOwner {
        _nativeToH2o(amount);
    }

    function nativeToReward(uint256 amount) external onlyOwner {
        _nativeToReward(amount);
    }

    function retrieveH2OTokens(uint256 amount) external override onlyOwner {
        _retrieveH2OTokens(amount);
    }

    receive() external payable {}

    function _transferH2OToSelf(uint256 amountToSwap, address from)
        private
        returns (uint256 transferredAmount)
    {
        uint256 h2oBalanceBefore = _getH2OBalance();
        IERC20(_h2oAddress).transferFrom(from, address(this), amountToSwap);
        transferredAmount = _getH2OBalance() - h2oBalanceBefore;
    }

    function _getH2OBalance() private view returns (uint256 balance) {
        balance = IERC20(_h2oAddress).balanceOf(address(this));
    }

    function _distributeDividend(address shareholder, uint256 unpaidEarnings)
        internal
    {
        if (shares[shareholder].amount == 0) {
            return;
        }
        if (unpaidEarnings > 0) {
            totalDistributed = totalDistributed + unpaidEarnings;
            IERC20(rewardTokenAddress).transfer(shareholder, unpaidEarnings);
            shareholderClaims[shareholder] = block.timestamp;

            shares[shareholder].totalRealised =
                shares[shareholder].totalRealised +
                unpaidEarnings;
            shares[shareholder].totalExcluded = _getCumulativeDividends(
                shares[shareholder].amount
            );
        }
    }

    function _getCumulativeDividends(uint256 share)
        internal
        view
        returns (uint256)
    {
        return (share * dividendsPerShare) / dividendsPerShareAccuracyFactor;
    }

    function _addShareholder(address shareholder) internal {
        shareholderIndexes[shareholder] = shareholders.length;
        shareholders.push(shareholder);
    }

    function _removeShareholder(address shareholder) internal {
        if (
            shares[shareholder].lastConversionNumerator !=
            tokenConversionNumerator ||
            shares[shareholder].lastConversionDivisor != tokenConversionDivisor
        ) tokenConversionProgress++;

        shareholders[shareholderIndexes[shareholder]] = shareholders[
            shareholders.length - 1
        ];
        shareholderIndexes[
            shareholders[shareholders.length - 1]
        ] = shareholderIndexes[shareholder];
        shareholders.pop();
    }

    function _processTokenChange(address shareholder) internal {
        if (
            shares[shareholder].lastConversionNumerator !=
            tokenConversionNumerator ||
            shares[shareholder].lastConversionDivisor != tokenConversionDivisor
        ) {
            shares[shareholder]
                .lastConversionNumerator = tokenConversionNumerator;
            shares[shareholder].lastConversionDivisor = tokenConversionDivisor;
            shares[shareholder].totalRealised =
                (shares[shareholder].totalRealised * tokenConversionNumerator) /
                tokenConversionDivisor;
            shares[shareholder].totalExcluded =
                (shares[shareholder].totalExcluded * tokenConversionNumerator) /
                tokenConversionDivisor;
        }
        tokenConversionProgress++;
    }

    function _retrieveH2OTokens(uint256 amount) private {
        IERC20(_h2oAddress).transfer(_h2oAddress, amount);
    }

    function _rewardToNative(uint256 amount) private {
        IUniswapV2Router02(rewardRouterAddress)
            .swapExactTokensForETHSupportingFeeOnTransferTokens(
                amount,
                0,
                rewardToNativeRoute,
                address(this),
                block.timestamp
            );
    }

    function _nativeToH2o(uint256 amount) private {
        IUniswapV2Router02(baseRouterAddress)
            .swapExactETHForTokensSupportingFeeOnTransferTokens{value: amount}(
            0,
            nativeToH2oTokenRoute,
            address(this),
            block.timestamp
        );
    }

    function _nativeToReward(uint256 amount) private {
        IUniswapV2Router02(rewardRouterAddress)
            .swapExactETHForTokensSupportingFeeOnTransferTokens{value: amount}(
            1,
            nativeToRewardRoute,
            address(this),
            block.timestamp
        );
    }
}
