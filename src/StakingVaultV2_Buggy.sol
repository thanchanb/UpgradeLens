// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./StakingVaultV1.sol";

/**
 * @title StakingVaultV2_Buggy
 * @notice Buggy V2 upgrade candidate.
 * @dev Storage layout is valid and append-only, but logic makes a faulty semantic assumption:
 *      it assumes `stakedSince[user]` is initialized for all stakers.
 *      For existing V1 stakers, `stakedSince[user]` is uninitialized (0),
 *      causing `getClaimableReward(user)` to drop to 0 and `isEligibleForReward(user)` to return false.
 */
contract StakingVaultV2_Buggy is StakingVaultV1 {
    // Appended storage variable (preserves EVM storage slot layout)
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
     * @notice Read-only observation with regression:
     *         The developer mistakenly added a check requiring `stakedSince[user] > 0`.
     *         For all existing V1 users, `stakedSince[user] == 0`, so this unexpectedly returns 0!
     */
    function getClaimableReward(address user) public view virtual override returns (uint256) {
        if (stakes[user] == 0) {
            return 0;
        }

        // REGRESSION: Uninitialized state assumption for legacy users
        if (stakedSince[user] == 0) {
            return 0;
        }

        uint256 timeElapsed = block.timestamp - lastClaimTimestamp[user];
        uint256 baseReward = (stakes[user] * timeElapsed * rewardRatePerSecond) / 1e18;

        // Loyalty bonus based on staking age
        uint256 duration = block.timestamp - stakedSince[user];
        uint256 bonusBps = duration >= 30 days ? 2000 : 1000; // 20% or 10%
        return (baseReward * (10000 + bonusBps)) / 10000;
    }

    /**
     * @notice Read-only observation with regression:
     *         Returns false for existing V1 users whose stakedSince is 0.
     */
    function isEligibleForReward(address user) public view virtual override returns (bool) {
        return stakes[user] > 0 && stakedSince[user] > 0;
    }

    /**
     * @notice Returns V2 implementation version.
     */
    function version() external pure virtual override returns (string memory) {
        return "V2_Buggy";
    }
}
