import { spawn } from 'child_process';
import fs from 'fs';
import {
    createPublicClient,
    createWalletClient,
    createTestClient,
    http,
    parseEther,
    encodeFunctionData,
    toHex
} from 'viem';
import { foundry } from 'viem/chains';

/**
 * Spawns an ephemeral Anvil node, executes contract deployment, state population,
 * time advancement, pre/post upgrade observation captures, and shuts down cleanly.
 */
export async function executeUpgradeScenario(scenario, eligibleCalls, port = 8546, customRpc = null) {
    let anvilProcess = null;
    const rpcUrl = customRpc || scenario.rpcUrl || `http://127.0.0.1:${port}`;

    try {
        if (!customRpc && !scenario.rpcUrl) {
            // 1. Spawn Ephemeral Local Anvil
            anvilProcess = spawn('anvil', ['--port', String(port), '--silent'], {
                env: {
                    ...process.env,
                    PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}`
                }
            });
            await waitForRpcReady(rpcUrl, 30);
        } else {
            // Connect to configured external RPC
            await waitForRpcReady(rpcUrl, 5);
        }

        // 2. Setup Viem Clients with fast local polling for Anvil
        const publicClient = createPublicClient({
            chain: foundry,
            transport: http(rpcUrl),
            pollingInterval: 100
        });

        const walletClient = createWalletClient({
            chain: foundry,
            transport: http(rpcUrl)
        });

        const testClient = createTestClient({
            mode: 'anvil',
            chain: foundry,
            transport: http(rpcUrl)
        });

        const accounts = await walletClient.getAddresses();
        const adminAccount = accounts[0];

        // Map configured actors to available Anvil accounts
        const actors = scenario.setup.actors.map((actor, idx) => ({
            name: actor.name,
            address: accounts[idx + 1] || accounts[idx],
            depositEth: actor.depositEth
        }));

        // Replace actor addresses in eligible calls that target specific actors
        const mappedCalls = eligibleCalls.map(call => {
            if (call.actorLabel && call.actorLabel !== 'GLOBAL') {
                const matched = actors.find(a => a.name === call.actorLabel);
                if (matched) {
                    return {
                        ...call,
                        args: [matched.address],
                        actorAddress: matched.address
                    };
                }
            }
            return call;
        });

        // 3. Deploy V1 Implementation
        const v1Artifact = JSON.parse(fs.readFileSync(scenario.v1Artifact, 'utf8'));
        const v1Abi = v1Artifact.abi;
        const v1Bytecode = v1Artifact.bytecode.object;

        const v1DeployHash = await walletClient.deployContract({
            abi: v1Abi,
            bytecode: v1Bytecode,
            account: adminAccount
        });
        const v1DeployReceipt = await publicClient.waitForTransactionReceipt({ hash: v1DeployHash });
        const v1ImplAddress = v1DeployReceipt.contractAddress;

        // 4. Deploy ERC1967Proxy pointing to V1 with initialize()
        const proxyArtifact = JSON.parse(fs.readFileSync(scenario.proxyArtifact, 'utf8'));
        const proxyAbi = proxyArtifact.abi;
        const proxyBytecode = proxyArtifact.bytecode.object;

        const initData = encodeFunctionData({
            abi: v1Abi,
            functionName: 'initialize',
            args: [adminAccount, BigInt(scenario.setup.rewardRate)]
        });

        const proxyDeployHash = await walletClient.deployContract({
            abi: proxyAbi,
            bytecode: proxyBytecode,
            args: [v1ImplAddress, initData],
            account: adminAccount
        });
        const proxyDeployReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyDeployHash });
        const proxyAddress = proxyDeployReceipt.contractAddress;

        // 5. Populate meaningful state across actors
        for (const actor of actors) {
            const stakeTxHash = await walletClient.writeContract({
                address: proxyAddress,
                abi: v1Abi,
                functionName: 'stake',
                value: parseEther(actor.depositEth),
                account: actor.address
            });
            await publicClient.waitForTransactionReceipt({ hash: stakeTxHash });
        }

        // 6. Advance Time if configured
        if (scenario.setup.advanceTimeSeconds > 0) {
            await testClient.increaseTime({ seconds: scenario.setup.advanceTimeSeconds });
            await testClient.mine({ blocks: 1 });
        }

        // 7. Capture Pre-Upgrade Observations
        const preUpgradeObservations = [];
        for (const call of mappedCalls) {
            try {
                const value = await publicClient.readContract({
                    address: proxyAddress,
                    abi: v1Abi,
                    functionName: call.functionName,
                    args: call.args
                });
                preUpgradeObservations.push({
                    call,
                    success: true,
                    value: serializeValue(value),
                    raw: value
                });
            } catch (err) {
                preUpgradeObservations.push({
                    call,
                    success: false,
                    error: err.shortMessage || err.message,
                    value: null
                });
            }
        }

        // 8. Capture Pre-Upgrade Storage Slots (raw EVM storage validation)
        const preStorageSlots = {};
        for (let slot = 0; slot <= 4; slot++) {
            preStorageSlots[slot] = await publicClient.getStorageAt({
                address: proxyAddress,
                slot: toHex(slot)
            });
        }

        // 9. Deploy V2 Implementation
        const v2Artifact = JSON.parse(fs.readFileSync(scenario.v2Artifact, 'utf8'));
        const v2Abi = v2Artifact.abi;
        const v2Bytecode = v2Artifact.bytecode.object;

        const v2DeployHash = await walletClient.deployContract({
            abi: v2Abi,
            bytecode: v2Bytecode,
            account: adminAccount
        });
        const v2DeployReceipt = await publicClient.waitForTransactionReceipt({ hash: v2DeployHash });
        const v2ImplAddress = v2DeployReceipt.contractAddress;

        // 10. Upgrade the exact same proxy (UUPS upgradeToAndCall)
        const upgradeTxHash = await walletClient.writeContract({
            address: proxyAddress,
            abi: v1Abi,
            functionName: 'upgradeToAndCall',
            args: [v2ImplAddress, '0x'],
            account: adminAccount
        });
        await publicClient.waitForTransactionReceipt({ hash: upgradeTxHash });

        // 11. Capture Post-Upgrade Observations
        const postUpgradeObservations = [];
        for (const call of mappedCalls) {
            try {
                const value = await publicClient.readContract({
                    address: proxyAddress,
                    abi: v2Abi,
                    functionName: call.functionName,
                    args: call.args
                });
                postUpgradeObservations.push({
                    call,
                    success: true,
                    value: serializeValue(value),
                    raw: value
                });
            } catch (err) {
                postUpgradeObservations.push({
                    call,
                    success: false,
                    error: err.shortMessage || err.message,
                    value: null
                });
            }
        }

        // 12. Capture Post-Upgrade Storage Slots
        const postStorageSlots = {};
        for (let slot = 0; slot <= 4; slot++) {
            postStorageSlots[slot] = await publicClient.getStorageAt({
                address: proxyAddress,
                slot: toHex(slot)
            });
        }

        return {
            proxyAddress,
            v1ImplAddress,
            v2ImplAddress,
            actors,
            preUpgradeObservations,
            postUpgradeObservations,
            preStorageSlots,
            postStorageSlots
        };
    } finally {
        if (anvilProcess) {
            try {
                anvilProcess.kill('SIGKILL');
                await new Promise((resolve) => {
                    anvilProcess.on('exit', resolve);
                    setTimeout(resolve, 200);
                });
            } catch (_) {}
        }
    }
}

/**
 * Polls JSON-RPC endpoint until available or timed out.
 */
async function waitForRpcReady(rpcUrl, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })
            });
            if (res.ok) return true;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for Anvil RPC at ${rpcUrl}`);
}

/**
 * Helper to serialize BigInts and complex EVM types to readable JSON/strings.
 */
function serializeValue(val) {
    if (typeof val === 'bigint') {
        return val.toString();
    }
    if (typeof val === 'boolean') {
        return val ? 'true' : 'false';
    }
    if (Array.isArray(val)) {
        return val.map(serializeValue);
    }
    if (typeof val === 'object' && val !== null) {
        const out = {};
        for (const [k, v] of Object.entries(val)) {
            out[k] = serializeValue(v);
        }
        return out;
    }
    return String(val);
}
