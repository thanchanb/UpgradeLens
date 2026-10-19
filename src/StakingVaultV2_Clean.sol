// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./StakingVaultV1.sol";

/**
 * @title StakingVaultV2_Clean
 * @notice Clean V2 control implementation.
 * @dev Preserves storage layout compatibility and safely handles legacy V1 user state.
 *      Existing V1 users continue to receive correct rewards and remain eligible.
 */
contract StakingVaultV2_Clean is StakingVaultV1 {
    // Appended storage variable (preserves EVM storage slot layout identically to Buggy V2)
    mapping(address => uint256) public stakedSince;

    /**
     * @notice Updated stake method that sets stakedSince for newly staking users.
     */
    function stakeV2() external payable {
        require(msg.value > 0, "Cannot stake 0");

        stakes[msg.sender] += msg.value;
        totalStaked += msg.value;

        if (lastClaimTimestamp[msg.sender] == 0) {
            lastClaimTimestamp[msg.sender] = block.timestamp;
        }

        if (stakedSince[msg.sender] == 0) {
            stakedSince[msg.sender] = block.timestamp;
        }

        emit Staked(msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Read-only observation with regression fix:
     *         Safely falls back to `lastClaimTimestamp[user]` if `stakedSince[user]` is uninitialized.
     */
    function getClaimableReward(address user) public view virtual override returns (uint256) {
        if (stakes[user] == 0) {
            return 0;
        }

        uint256 timeElapsed = block.timestamp - lastClaimTimestamp[user];
        uint256 baseReward = (stakes[user] * timeElapsed * rewardRatePerSecond) / 1e18;

        // Clean backward compatibility: fallback to lastClaimTimestamp for legacy users
        uint256 effectiveSince = stakedSince[user] == 0 ? lastClaimTimestamp[user] : stakedSince[user];
        uint256 duration = block.timestamp >= effectiveSince ? block.timestamp - effectiveSince : 0;
        uint256 bonusBps = duration >= 30 days ? 2000 : 1000; // 20% or 10%
        return (baseReward * (10000 + bonusBps)) / 10000;
    }

    /**
     * @notice Preserved eligibility check for all active stakers.
     */
    function isEligibleForReward(address user) public view virtual override returns (bool) {
        return stakes[user] > 0;
    }

    /**
     * @notice Returns V2 implementation version.
     */
    function version() external pure virtual override returns (string memory) {
        return "V2_Clean";
    }
}
