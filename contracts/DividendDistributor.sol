// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IDividendDistributor.sol";
import "./interfaces/IUniswapV2Router02.sol";

contract DividendDistributor is IDividendDistributor {
    address _hydro;

    struct Share {
        uint256 amount;
        uint256 totalExcluded;
        uint256 totalRealised;
        uint256 lastConversionNumerator;
        uint256 lastConversionDivisor;
    }

    IERC20 TOKEN;
    address native;
    IUniswapV2Router02 router;
    address[] public toNativeRoute;
    address[] public fromNativeRoute;

    address[] shareholders;
    mapping(address => uint256) shareholderIndexes;
    mapping(address => uint256) shareholderClaims;

    mapping(address => Share) public shares;

    uint256 public totalShares;
    uint256 public totalDividends;
    uint256 public totalDistributed;
    uint256 public dividendsPerShare;
    uint256 public dividendsPerShareAccuracyFactor = 10**36;
    uint256 public tokenConversionNumerator;
    uint256 public tokenConversionDivisor;
    uint256 public tokenConversionCount;
    uint256 public tokenConversionProgress;

    uint256 public minPeriod = 1 hours;
    uint256 public minDistribution = 1 * (10**18);

    uint256 currentIndex;

    bool initialized;
    modifier initialization() {
        require(!initialized);
        _;
        initialized = true;
    }

    modifier onlyToken() {
        require(msg.sender == _hydro);
        _;
    }

    constructor(
        address _router,
        address _token,
        address[] memory _toNativeRoute,
        address[] memory _fromNativeRoute
    ) {
        router = IUniswapV2Router02(_router);
        TOKEN = IERC20(_token);
        toNativeRoute = _toNativeRoute;
        fromNativeRoute = _fromNativeRoute;
        native = _toNativeRoute[_toNativeRoute.length - 1];
        _hydro = msg.sender;
    }

    function changeToken(
        address _token,
        address[] memory _toNativeRoute,
        address[] memory _fromNativeRoute,
        address _router,
        bool forceChange
    ) external override onlyToken {
        require(
            tokenConversionCount <= tokenConversionProgress || forceChange,
            "Previous conversion not complete."
        );
        tokenConversionDivisor = TOKEN.balanceOf(address(this));
        require(
            totalDividends == 0 || tokenConversionDivisor > 0,
            "Requires at least some of initial token to calculate convertion rate."
        );

        if (tokenConversionDivisor > 0) {
            TOKEN.approve(address(router), tokenConversionDivisor);

            if (address(TOKEN) != native) {
                // first move to native token with old router
                router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    tokenConversionDivisor,
                    0,
                    toNativeRoute,
                    address(this),
                    block.timestamp
                );
            }

            tokenConversionCount = shareholders.length;
            tokenConversionProgress = 0;
        }

        router = IUniswapV2Router02(_router);
        toNativeRoute = _toNativeRoute;
        fromNativeRoute = _fromNativeRoute;
        uint256 nativeBal = IERC20(native).balanceOf(address(this));
        if (nativeBal > 0 && _token != native) {
            IERC20(native).approve(address(router), nativeBal);
            // than, with new router, move to new token
            router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                nativeBal,
                0,
                _fromNativeRoute,
                address(this),
                block.timestamp
            );
        }
        TOKEN = IERC20(_token);

        if (totalDividends > 0) {
            tokenConversionNumerator = TOKEN.balanceOf(address(this));

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
        override
        returns (uint256 count, uint256 progress)
    {
        return (tokenConversionCount, tokenConversionProgress);
    }

    function processTokenChange(address shareholder) internal {
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

    function setDistributionCriteria(
        uint256 _minPeriod,
        uint256 _minDistribution
    ) external override onlyToken {
        minPeriod = _minPeriod;
        minDistribution = _minDistribution;
    }

    function setShare(address shareholder, uint256 amount)
        external
        override
        onlyToken
    {
        if (shares[shareholder].amount > 0) {
            if (
                shares[shareholder].lastConversionNumerator !=
                tokenConversionNumerator ||
                shares[shareholder].lastConversionDivisor !=
                tokenConversionDivisor
            ) {
                processTokenChange(shareholder);
            }
            distributeDividend(shareholder, getUnpaidEarnings(shareholder));
        }

        if (amount > 0 && shares[shareholder].amount == 0) {
            addShareholder(shareholder);
        } else if (amount == 0 && shares[shareholder].amount > 0) {
            removeShareholder(shareholder);
        }

        totalShares = (totalShares - shares[shareholder].amount) + amount;
        shares[shareholder].amount = amount;
        shares[shareholder].totalExcluded = getCumulativeDividends(
            shares[shareholder].amount
        );
    }

    function deposit() external payable override onlyToken {
        uint256 balanceBefore = TOKEN.balanceOf(address(this));

        router.swapExactETHForTokensSupportingFeeOnTransferTokens{
            value: msg.value
        }(0, fromNativeRoute, address(this), block.timestamp);

        uint256 amount = TOKEN.balanceOf(address(this)) - balanceBefore;

        totalDividends = totalDividends + amount;
        dividendsPerShare =
            dividendsPerShare +
            ((dividendsPerShareAccuracyFactor * amount) / totalShares);
    }

    function process(uint256 gas) external override onlyToken {
        uint256 shareholderCount = shareholders.length;

        if (shareholderCount == 0) {
            return;
        }

        uint256 gasUsed = 0;
        uint256 gasLeft = gasleft();

        uint256 iterations = 0;

        while (gasUsed < gas && iterations < shareholderCount) {
            if (currentIndex >= shareholderCount) {
                currentIndex = 0;
            }

            if (
                shares[shareholders[currentIndex]].lastConversionNumerator !=
                tokenConversionNumerator ||
                shares[shareholders[currentIndex]].lastConversionDivisor !=
                tokenConversionDivisor
            ) processTokenChange(shareholders[currentIndex]);

            uint256 unpaidEarnings = getUnpaidEarnings(
                shareholders[currentIndex]
            );
            if (shouldDistribute(shareholders[currentIndex], unpaidEarnings)) {
                distributeDividend(shareholders[currentIndex], unpaidEarnings);
            }

            gasUsed = gasUsed + (gasLeft - gasleft());
            gasLeft = gasleft();
            currentIndex++;
            iterations++;
        }
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

    function distributeDividend(address shareholder, uint256 unpaidEarnings)
        internal
    {
        if (shares[shareholder].amount == 0) {
            return;
        }

        if (unpaidEarnings > 0) {
            totalDistributed = totalDistributed + unpaidEarnings;
            TOKEN.transfer(shareholder, unpaidEarnings);
            shareholderClaims[shareholder] = block.timestamp;

            shares[shareholder].totalRealised =
                shares[shareholder].totalRealised +
                unpaidEarnings;
            shares[shareholder].totalExcluded = getCumulativeDividends(
                shares[shareholder].amount
            );
        }
    }

    function claimDividend(address shareholder) external override {
        if (
            shares[shareholder].lastConversionNumerator !=
            tokenConversionNumerator ||
            shares[shareholder].lastConversionDivisor != tokenConversionDivisor
        ) {
            processTokenChange(shareholder);
        }
        distributeDividend(shareholder, getUnpaidEarnings(shareholder));
    }

    function getUnpaidEarnings(address shareholder)
        public
        view
        returns (uint256)
    {
        if (shares[shareholder].amount == 0) {
            return 0;
        }

        uint256 shareholderTotalDividends = getCumulativeDividends(
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
        override
        returns (uint256)
    {
        return getUnpaidEarnings(shareholder);
    }

    function getCumulativeDividends(uint256 share)
        internal
        view
        returns (uint256)
    {
        return (share * dividendsPerShare) / dividendsPerShareAccuracyFactor;
    }

    function addShareholder(address shareholder) internal {
        shareholderIndexes[shareholder] = shareholders.length;
        shareholders.push(shareholder);
    }

    function removeShareholder(address shareholder) internal {
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

    function token() public view returns (address _token) {
        return address(TOKEN);
    }
}
