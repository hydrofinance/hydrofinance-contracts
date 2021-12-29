// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../interfaces/IH2OPlugin.sol";
import "../utils/UtilsLibrary.sol";

// import "hardhat/console.sol";

abstract contract H2OPluginManager is Ownable {
    using SafeMath for uint256;

    struct PluginCandidate {
        uint8 pluginId;
        address implementation;
        uint256 proposedTime;
    }

    uint8 internal constant LIQUIDITY_PLUGIN_ID = 1;
    uint8 internal constant DISTRIBUTOR_PLUGIN_ID = 2;

    uint256 private constant MIN_APPROVAL_DELAY = 1 days;

    mapping(uint8 => address) private _plugins;
    mapping(uint8 => PluginCandidate) public pluginCandidates;

    uint256 public approvalDelay;
    uint256 public proposedApprovalDelay;
    uint256 public proposedApprovalDelayTime;

    event NewPluginCandidate(uint8 indexed pluginId, address implementation);
    event PluginUpgraded(uint8 indexed pluginId, address implementation);

    event NewApprovalDelayCandidate(uint256 approvalDelay);
    event ApprovalDelayUpgraded(uint256 approvalDelay);

    constructor(uint256 _approvalDelay) {
        approvalDelay = _approvalDelay;
    }

    function setupPlugin(uint8 _pluginId, address _implementation)
        external
        onlyOwner
    {
        require(_plugins[_pluginId] == address(0), "Plugin already setup");
        require(
            address(this) == IH2OPlugin(_implementation).h2oAddress(),
            "Plugin not valid"
        );
        _plugins[_pluginId] = _implementation;
        onPluginUpgraded(_pluginId, false);
    }

    function proposePlugin(uint8 _pluginId, address _implementation)
        external
        onlyOwner
    {
        require(
            address(this) == IH2OPlugin(_implementation).h2oAddress(),
            "Plugin not valid"
        );
        pluginCandidates[_pluginId] = PluginCandidate({
            pluginId: _pluginId,
            implementation: _implementation,
            proposedTime: block.timestamp
        });

        emit NewPluginCandidate(_pluginId, _implementation);
    }

    function upgradePlugin(uint8 _pluginId) external onlyOwner {
        PluginCandidate storage candidate = pluginCandidates[_pluginId];

        require(
            candidate.implementation != address(0),
            "There is no candidate"
        );
        require(
            proposedApprovalDelay == 0,
            "Cannot upgrade plugin while changing approval delay"
        );
        require(
            candidate.proposedTime.add(approvalDelay) < block.timestamp,
            "Delay has not passed"
        );

        emit PluginUpgraded(_pluginId, candidate.implementation);

        if (_plugins[_pluginId] != address(0)) {
            try IH2OPlugin(_plugins[_pluginId]).retirePlugin() {} catch (
                bytes memory reason
            ) {
                emit UtilsLibrary.ErrorLog(reason);
            }
        }
        _plugins[_pluginId] = candidate.implementation;
        candidate.implementation = address(0);
        candidate.proposedTime = 5000000000;

        onPluginUpgraded(_pluginId, true);
    }

    function proposeApprovalDelay(uint256 _approvalDelay) external onlyOwner {
        require(_approvalDelay >= MIN_APPROVAL_DELAY, "Delay too small");
        proposedApprovalDelay = _approvalDelay;
        proposedApprovalDelayTime = block.timestamp;

        emit NewApprovalDelayCandidate(_approvalDelay);
    }

    function upgradeApprovalDelay() external onlyOwner {
        require(proposedApprovalDelay != 0, "There is no candidate");
        require(
            proposedApprovalDelayTime.add(approvalDelay) < block.timestamp,
            "Delay has not passed"
        );

        emit ApprovalDelayUpgraded(proposedApprovalDelay);

        approvalDelay = proposedApprovalDelay;
        proposedApprovalDelayTime = 5000000000;
        proposedApprovalDelay = 0;
    }

    function onPluginUpgraded(uint8, bool) internal virtual {}

    function plugin(uint8 _pluginId)
        public
        view
        returns (address pluginAddress)
    {
        pluginAddress = _plugins[_pluginId];
    }
}
