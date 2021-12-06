// SPDX-License-Identifier: Unlicensed

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./H2O.sol";

contract Airdrop is Ownable {
    using SafeMath for uint256;

    struct UserInfo {
        uint256 amount; // How many tokens to be airdropped
        uint256 claimedAmount; // How many tokens did already received
    }

    mapping(address => UserInfo) public userInfo;

    H2O public token;
    uint256 public totalPending;
    uint256 public endTime;

    constructor(
        H2O _token,
        address[] memory addresses,
        uint256[] memory amounts,
        uint256 _timeToClaim
    ) {
        require(addresses.length == amounts.length, "Lengt's not matching");

        token = _token;
        endTime = block.timestamp + _timeToClaim;

        for (uint256 i = 0; i < addresses.length; i++) {
            userInfo[addresses[i]] = UserInfo({
                amount: amounts[i],
                claimedAmount: 0
            });
            totalPending += amounts[i];
        }
    }

    function claimAll() external {
        UserInfo memory user = userInfo[msg.sender];
        _claim(user.amount.sub(user.claimedAmount), msg.sender);
    }

    function claim(uint256 amount) external {
        _claim(amount, msg.sender);
    }

    function _claim(uint256 amount, address userAddress) internal {
        require(block.timestamp < endTime, "airdrop ended");
        require(amount > 0, "amount <= 0");

        UserInfo storage user = userInfo[userAddress];
        require(user.amount > 0, "no airdrop");

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

        token.transferFrom(address(this), userAddress, amount);
    }

    function withdraw(address toAddress) external onlyOwner {
        require(block.timestamp > endTime, "airdrop not ended");

        uint256 balance = token.balanceOf(address(this));
        token.transferFrom(address(this), toAddress, balance);
    }
}
