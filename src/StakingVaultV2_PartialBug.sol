// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./StakingVaultV1.sol";

/**
 * @title StakingVaultV2_PartialBug
 * @notice Realistic partial-bug upgrade candidate.
 * @dev Storage layout is fully compatible.
 *      Introduces a tier-threshold logic regression: stakers at or below 50 ETH (e.g. Charlie)
 *      hit an off-by-one tier condition that wrongly zeroes their reward and revokes eligibility,
 *      while stakers above 50 ETH (Alice: 100 ETH, Bob: 250 ETH) continue receiving correct rewards.
 */
contract StakingVaultV2_PartialBug is StakingVaultV1 {
    // Appended storage variable (preserves EVM storage slot layout identically to Clean V2)
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
     * @notice Read-only observation with targeted regression:
     *         An off-by-one tier check `stakes[user] > 50 ether` wrongly drops Charlie (50 ETH)
     *         to 0, while Alice (100 ETH) and Bob (250 ETH) calculate correctly.
     */
    function getClaimableReward(address user) public view virtual override returns (uint256) {
        if (stakes[user] == 0) {
            return 0;
        }

        // REGRESSION: Off-by-one tier threshold excludes stakers with exactly 50 ETH (Charlie)
        if (stakes[user] <= 50 ether) {
            return 0;
        }

        uint256 timeElapsed = block.timestamp - lastClaimTimestamp[user];
        uint256 baseReward = (stakes[user] * timeElapsed * rewardRatePerSecond) / 1e18;

        uint256 effectiveSince = stakedSince[user] == 0 ? lastClaimTimestamp[user] : stakedSince[user];
        uint256 duration = block.timestamp >= effectiveSince ? block.timestamp - effectiveSince : 0;
        uint256 bonusBps = duration >= 30 days ? 2000 : 1000;
        return (baseReward * (10000 + bonusBps)) / 10000;
    }

    /**
     * @notice Eligibility regression affecting only stakers <= 50 ETH.
     */
    function isEligibleForReward(address user) public view virtual override returns (bool) {
        if (stakes[user] <= 50 ether) {
            return false;
        }
        return stakes[user] > 0;
    }

    /**
     * @notice Returns V2 implementation version.
     */
    function version() external pure virtual override returns (string memory) {
        return "V2_PartialBug";
    }
}
