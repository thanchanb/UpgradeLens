// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/StakingVaultV1.sol";
import "../src/StakingVaultV2_Buggy.sol";
import "../src/StakingVaultV2_Clean.sol";

/**
 * @title UpgradeRegressionTest
 * @notice Phase 1 Foundry verification test suite for UpgradeLens.
 * @dev Demonstrates stateful proxy upgrade regression vs clean control on identical proxy state.
 */
contract UpgradeRegressionTest is Test {
    address public admin;
    address public alice;
    address public bob;
    address public charlie;

    uint256 public constant REWARD_RATE = 1e12; // reward rate per second
    uint256 public constant ALICE_STAKE = 100 ether;
    uint256 public constant BOB_STAKE = 250 ether;
    uint256 public constant CHARLIE_STAKE = 50 ether;

    function setUp() public {
        admin = makeAddr("admin");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.deal(charlie, 1000 ether);
    }

    /**
     * @notice Helper to deploy V1 behind an ERC1967Proxy and populate 3 actors.
     */
    function _deployAndPopulateV1() internal returns (address payable proxyAddress, StakingVaultV1 vault) {
        // 1. Deploy V1 Implementation
        StakingVaultV1 v1Impl = new StakingVaultV1();

        // 2. Encode initialization calldata
        bytes memory initData = abi.encodeWithSelector(
            StakingVaultV1.initialize.selector,
            admin,
            REWARD_RATE
        );

        // 3. Deploy standard ERC1967Proxy pointing to V1
        ERC1967Proxy proxy = new ERC1967Proxy(address(v1Impl), initData);
        proxyAddress = payable(address(proxy));
        vault = StakingVaultV1(proxyAddress);

        // 4. Populate meaningful state for 3 actors
        vm.prank(alice);
        vault.stake{value: ALICE_STAKE}();

        vm.prank(bob);
        vault.stake{value: BOB_STAKE}();

        vm.prank(charlie);
        vault.stake{value: CHARLIE_STAKE}();

        // Verify initial state
        assertEq(vault.totalStaked(), ALICE_STAKE + BOB_STAKE + CHARLIE_STAKE);
        assertEq(vault.stakes(alice), ALICE_STAKE);
        assertEq(vault.stakes(bob), BOB_STAKE);
        assertEq(vault.stakes(charlie), CHARLIE_STAKE);
    }

    /**
     * @notice Test 1: Verify deployment and initial state population.
     */
    function test_DeployV1AndPopulateThreeActors() public {
        (address payable proxyAddress, StakingVaultV1 vault) = _deployAndPopulateV1();

        assertEq(vault.version(), "V1");
        assertEq(vault.owner(), admin);
        assertEq(vault.totalStaked(), 400 ether);
        assertTrue(vault.isEligibleForReward(alice));
        assertTrue(vault.isEligibleForReward(bob));
        assertTrue(vault.isEligibleForReward(charlie));
        assertTrue(proxyAddress != address(0));
    }

    /**
     * @notice Test 2: Reproduce the Upgrade Regression in Buggy V2.
     * Demonstrates that storage is preserved, but read-only behavior regresses for existing users.
     */
    function test_BuggyUpgradeRegression() public {
        (address payable proxyAddress, StakingVaultV1 vault) = _deployAndPopulateV1();

        // Advance time by 7 days to accumulate meaningful reward state
        vm.warp(block.timestamp + 7 days);

        // Pre-upgrade observations
        uint256 preTotalStaked = vault.totalStaked();
        uint256 preAliceStake = vault.stakes(alice);
        uint256 preBobStake = vault.stakes(bob);
        uint256 preCharlieStake = vault.stakes(charlie);

        uint256 preAliceReward = vault.getClaimableReward(alice);
        uint256 preBobReward = vault.getClaimableReward(bob);
        uint256 preCharlieReward = vault.getClaimableReward(charlie);

        bool preAliceEligible = vault.isEligibleForReward(alice);
        bool preBobEligible = vault.isEligibleForReward(bob);
        bool preCharlieEligible = vault.isEligibleForReward(charlie);

        // Ensure pre-upgrade rewards are positive
        assertGt(preAliceReward, 0, "Alice must have earned positive reward in V1");
        assertGt(preBobReward, 0, "Bob must have earned positive reward in V1");
        assertGt(preCharlieReward, 0, "Charlie must have earned positive reward in V1");
        assertTrue(preAliceEligible && preBobEligible && preCharlieEligible);

        console.log("=== PRE-UPGRADE OBSERVATIONS (V1) ===");
        console.log("Proxy Address:             ", proxyAddress);
        console.log("Alice Pre-Upgrade Reward:  ", preAliceReward);
        console.log("Bob Pre-Upgrade Reward:    ", preBobReward);
        console.log("Charlie Pre-Upgrade Reward:", preCharlieReward);

        // Deploy Buggy V2 Implementation
        StakingVaultV2_Buggy buggyImpl = new StakingVaultV2_Buggy();

        // Upgrade the exact same proxy (UUPS upgrade)
        vm.prank(admin);
        vault.upgradeToAndCall(address(buggyImpl), "");

        // Confirm proxy address remains identical
        assertEq(address(vault), proxyAddress, "Proxy address must not change across upgrade");

        // Cast proxy interface to V2
        StakingVaultV2_Buggy buggyVault = StakingVaultV2_Buggy(proxyAddress);
        assertEq(buggyVault.version(), "V2_Buggy");

        // Verify underlying storage values are preserved
        assertEq(buggyVault.totalStaked(), preTotalStaked, "totalStaked storage must be preserved");
        assertEq(buggyVault.stakes(alice), preAliceStake, "Alice stake storage must be preserved");
        assertEq(buggyVault.stakes(bob), preBobStake, "Bob stake storage must be preserved");
        assertEq(buggyVault.stakes(charlie), preCharlieStake, "Charlie stake storage must be preserved");

        // Post-upgrade observations: demonstrate genuine regression
        uint256 postAliceReward = buggyVault.getClaimableReward(alice);
        uint256 postBobReward = buggyVault.getClaimableReward(bob);
        uint256 postCharlieReward = buggyVault.getClaimableReward(charlie);

        bool postAliceEligible = buggyVault.isEligibleForReward(alice);
        bool postBobEligible = buggyVault.isEligibleForReward(bob);
        bool postCharlieEligible = buggyVault.isEligibleForReward(charlie);

        console.log("=== POST-UPGRADE OBSERVATIONS (BUGGY V2) ===");
        console.log("Alice Post-Upgrade Reward:  ", postAliceReward);
        console.log("Bob Post-Upgrade Reward:    ", postBobReward);
        console.log("Charlie Post-Upgrade Reward:", postCharlieReward);
        console.log("Alice Eligible:             ", postAliceEligible);

        // DEMONSTRATED REGRESSION:
        // Existing users had positive rewards and active eligibility in V1.
        // In Buggy V2, rewards drop to 0 and eligibility drops to false due to uninitialized stakedSince mapping.
        assertEq(postAliceReward, 0, "REGRESSION DETECTED: Alice reward dropped to 0");
        assertEq(postBobReward, 0, "REGRESSION DETECTED: Bob reward dropped to 0");
        assertEq(postCharlieReward, 0, "REGRESSION DETECTED: Charlie reward dropped to 0");
        assertFalse(postAliceEligible, "REGRESSION DETECTED: Alice eligibility dropped to false");
        assertFalse(postBobEligible, "REGRESSION DETECTED: Bob eligibility dropped to false");
        assertFalse(postCharlieEligible, "REGRESSION DETECTED: Charlie eligibility dropped to false");

        assertTrue(postAliceReward != preAliceReward, "Behavioral difference confirmed for Alice");
        assertTrue(postBobReward != preBobReward, "Behavioral difference confirmed for Bob");
        assertTrue(postCharlieReward != preCharlieReward, "Behavioral difference confirmed for Charlie");
    }

    /**
     * @notice Test 3: Verify the Clean Control Implementation.
     * Demonstrates that the clean V2 upgrade preserves observations and behavior for existing users.
     */
    function test_CleanUpgradeControl() public {
        (address payable proxyAddress, StakingVaultV1 vault) = _deployAndPopulateV1();

        // Advance time by 7 days
        vm.warp(block.timestamp + 7 days);

        // Pre-upgrade observations
        uint256 preAliceReward = vault.getClaimableReward(alice);
        uint256 preBobReward = vault.getClaimableReward(bob);
        uint256 preCharlieReward = vault.getClaimableReward(charlie);

        assertGt(preAliceReward, 0);
        assertGt(preBobReward, 0);
        assertGt(preCharlieReward, 0);

        // Deploy Clean V2 Implementation
        StakingVaultV2_Clean cleanImpl = new StakingVaultV2_Clean();

        // Upgrade the exact same proxy (UUPS upgrade)
        vm.prank(admin);
        vault.upgradeToAndCall(address(cleanImpl), "");

        // Confirm proxy address remains identical
        assertEq(address(vault), proxyAddress, "Proxy address must remain unchanged");

        // Cast proxy interface to V2 Clean
        StakingVaultV2_Clean cleanVault = StakingVaultV2_Clean(proxyAddress);
        assertEq(cleanVault.version(), "V2_Clean");

        // Verify underlying storage is preserved
        assertEq(cleanVault.totalStaked(), 400 ether);
        assertEq(cleanVault.stakes(alice), ALICE_STAKE);
        assertEq(cleanVault.stakes(bob), BOB_STAKE);
        assertEq(cleanVault.stakes(charlie), CHARLIE_STAKE);

        // Post-upgrade observations: verify behavior is preserved and enhanced cleanly
        uint256 postAliceReward = cleanVault.getClaimableReward(alice);
        uint256 postBobReward = cleanVault.getClaimableReward(bob);
        uint256 postCharlieReward = cleanVault.getClaimableReward(charlie);

        bool postAliceEligible = cleanVault.isEligibleForReward(alice);
        bool postBobEligible = cleanVault.isEligibleForReward(bob);
        bool postCharlieEligible = cleanVault.isEligibleForReward(charlie);

        console.log("=== POST-UPGRADE OBSERVATIONS (CLEAN V2 CONTROL) ===");
        console.log("Alice Post-Upgrade Reward:  ", postAliceReward);
        console.log("Bob Post-Upgrade Reward:    ", postBobReward);
        console.log("Charlie Post-Upgrade Reward:", postCharlieReward);
        console.log("Alice Eligible:             ", postAliceEligible);

        // VERIFIED CLEAN CONTROL:
        // Rewards remain positive and accurately computed
        assertGt(postAliceReward, 0, "Alice reward preserved in clean V2");
        assertGt(postBobReward, 0, "Bob reward preserved in clean V2");
        assertGt(postCharlieReward, 0, "Charlie reward preserved in clean V2");
        assertGe(postAliceReward, preAliceReward, "Alice reward earns bonus/preserves base reward");

        // Eligibility preserved
        assertTrue(postAliceEligible, "Alice eligibility preserved");
        assertTrue(postBobEligible, "Bob eligibility preserved");
        assertTrue(postCharlieEligible, "Charlie eligibility preserved");
    }
}
