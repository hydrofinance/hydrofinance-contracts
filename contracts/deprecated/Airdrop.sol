// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./H2O.sol";

// import "hardhat/console.sol";

contract Airdrop is Ownable {
    using SafeMath for uint256;

    event Claim(address indexed user, uint256 value);
    event Withdraw(address indexed to, uint256 value);
    event Update(address indexed user, uint256 newAmount);
    event MassUpdate();
    event Start();

    struct UserInfo {
        uint256 amount; // How many tokens to be airdropped
        uint256 claimedAmount; // How many tokens did already received
    }

    mapping(address => UserInfo) public userInfo;

    H2O public token;
    uint256 public totalPending;
    uint256 public endTime = 0;
    uint256 public startTime = 0;
    uint256 public timeToClaim;

    constructor(H2O _token, uint256 _timeToClaim) {
        token = _token;
        timeToClaim = _timeToClaim;
    }

    function start() external onlyOwner {
        require(totalPending > 0, "not configured");

        uint256 bal = token.balanceOf(address(this));
        require(bal >= totalPending, "incorrect token balance");

        startTime = block.timestamp;
        endTime = block.timestamp + timeToClaim;

        emit Start();
    }

    function update(address addr, uint256 newAmount) external onlyOwner {
        UserInfo storage user = userInfo[addr];

        if (newAmount >= user.amount) {
            totalPending = totalPending.add(newAmount.sub(user.amount));
        } else {
            require(
                user.claimedAmount <= newAmount,
                "new amount cannot be smaller than claimed amount"
            );
            uint256 diff = user.amount.sub(newAmount);
            totalPending = totalPending.sub(diff);
        }
        user.amount = newAmount;

        uint256 bal = token.balanceOf(address(this));
        require(bal >= totalPending, "incorrect token balance");

        emit Update(addr, newAmount);
    }

    function massUpdate(address[] memory addresses, uint256[] memory amounts)
        external
        onlyOwner
    {
        require(startTime == 0, "airdop already started");
        require(addresses.length > 0, "Empty addresses");
        require(addresses.length == amounts.length, "Length's not matching");
        for (uint256 i = 0; i < addresses.length; i++) {
            require(
                userInfo[addresses[i]].amount == 0,
                "User already configured"
            );
            userInfo[addresses[i]] = UserInfo({
                amount: amounts[i],
                claimedAmount: 0
            });
            totalPending += amounts[i];
        }

        emit MassUpdate();
    }

    function pendingClaim(address addr) external view returns (uint256 amount) {
        UserInfo memory user = userInfo[addr];
        return user.amount.sub(user.claimedAmount);
    }

    function claimAll() external {
        UserInfo memory user = userInfo[msg.sender];
        _claim(user.amount.sub(user.claimedAmount), msg.sender);
    }

    function claim(uint256 amount) external {
        _claim(amount, msg.sender);
    }

    function _claim(uint256 amount, address userAddress) internal {
        require(startTime > 0, "airdop not started");
        require(block.timestamp < endTime, "airdrop ended");
        require(amount > 0, "amount == 0");

        UserInfo storage user = userInfo[userAddress];
        require(user.amount > 0, "no airdrop");
        require(user.amount >= amount, "too big amount");

        uint256 allowedClaim = user.amount.sub(user.claimedAmount);
        require(allowedClaim > 0, "already claimed");

        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "no Balance");

        if (amount > allowedClaim) {
            amount = allowedClaim;
        }
        if (amount > balance) {
            amount = balance;
        }

        user.claimedAmount += amount;
        totalPending -= amount;

        token.transfer(userAddress, amount);

        emit Claim(userAddress, amount);
    }

    function withdraw(address toAddress) external onlyOwner {
        require(startTime > 0, "airdop not started");
        require(block.timestamp > endTime, "airdrop not ended");

        uint256 balance = token.balanceOf(address(this));
        token.transfer(toAddress, balance);

        emit Withdraw(toAddress, balance);
    }
}
