// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title StakingVaultV1
 * @notice Original V1 implementation for stateful proxy upgrade regression testing.
 * @dev Deployed behind an ERC1967Proxy and upgraded via UUPS.
 */
contract StakingVaultV1 is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    // Storage Layout V1
    uint256 public totalStaked;
    uint256 public rewardRatePerSecond; // reward unit per wei staked per second (scaled by 1e18)
    mapping(address => uint256) public stakes;
    mapping(address => uint256) public lastClaimTimestamp;

    event Staked(address indexed user, uint256 amount, uint256 timestamp);
    event RewardClaimed(address indexed user, uint256 rewardAmount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the V1 contract.
     * @param initialOwner Address of the contract owner / upgrader.
     * @param _rewardRatePerSecond Reward emission rate scaled by 1e18.
     */
    function initialize(address initialOwner, uint256 _rewardRatePerSecond) external initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        rewardRatePerSecond = _rewardRatePerSecond;
    }

    /**
     * @notice Stake native ETH into the vault.
     */
    function stake() external payable {
        require(msg.value > 0, "Cannot stake 0");

        stakes[msg.sender] += msg.value;
        totalStaked += msg.value;

        // If first deposit, record timestamp
        if (lastClaimTimestamp[msg.sender] == 0) {
            lastClaimTimestamp[msg.sender] = block.timestamp;
        }

        emit Staked(msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Read-only observation: returns accumulated claimable reward.
     * @param user Address of the staker.
     */
    function getClaimableReward(address user) public view virtual returns (uint256) {
        if (stakes[user] == 0) {
            return 0;
        }
        uint256 timeElapsed = block.timestamp - lastClaimTimestamp[user];
        return (stakes[user] * timeElapsed * rewardRatePerSecond) / 1e18;
    }

    /**
     * @notice Read-only observation: returns whether account is eligible for rewards.
     * @param user Address of the staker.
     */
    function isEligibleForReward(address user) public view virtual returns (bool) {
        return stakes[user] > 0;
    }

    /**
     * @notice Read-only observation: returns current implementation version string.
     */
    function version() external pure virtual returns (string memory) {
        return "V1";
    }

    /**
     * @dev Restricts upgrade authorization to contract owner.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
