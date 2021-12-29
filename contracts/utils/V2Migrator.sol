// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../deprecated/H2O.sol";
import "../H2Ov2.sol";

contract V2Migrator is Ownable {
    H2O immutable h2o;
    H2Ov2 immutable h2ov2;

    uint256 public immutable endTime;
    uint256 public immutable startTime;
    // half a year for migration
    uint256 public constant TIME_TO_MIGRATE = 24 weeks;

    constructor(address payable h2oAddress, address h2ov2Address) {
        h2o = H2O(h2oAddress);
        h2ov2 = H2Ov2(h2ov2Address);

        startTime = block.timestamp;
        endTime = block.timestamp + TIME_TO_MIGRATE;
    }

    function migrateAll() external {
        migrate(h2o.balanceOf(_msgSender()));
    }

    function migrate(uint256 amount) public {
        require(
            h2ov2.balanceOf(address(this)) >= amount,
            "No required h2ov2 balance"
        );

        h2o.transferFrom(
            _msgSender(),
            address(0x0000000000000000000000000000000000000000),
            amount
        );
        h2ov2.transfer(_msgSender(), amount);
    }

    function withdrawAll(address to) external onlyOwner {
        require(block.timestamp > endTime, "Migration did not finished");
        h2ov2.transfer(to, h2ov2.balanceOf(_msgSender()));
    }
}
