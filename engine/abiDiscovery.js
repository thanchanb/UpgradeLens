import fs from 'fs';
import path from 'path';

/**
 * ABI Discovery Engine for UpgradeLens.
 * Inspects compiled contract artifacts to discover eligible view and pure functions,
 * maps them to test actors/arguments, and transparently accounts for skipped functions.
 */
export function discoverFunctionsFromArtifact(artifactPath, actors = [], ignoreFunctions = []) {
    if (!fs.existsSync(artifactPath)) {
        throw new Error(`Artifact file not found: ${artifactPath}`);
    }

    const artifactJson = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const abi = artifactJson.abi || [];

    const totalFunctions = abi.filter(item => item.type === 'function');
    const eligibleCalls = [];
    const skippedReadOnly = [];
    const nonViewFunctions = [];

    for (const item of totalFunctions) {
        const isReadOnly = item.stateMutability === 'view' || item.stateMutability === 'pure';

        if (!isReadOnly) {
            nonViewFunctions.push({
                name: item.name,
                signature: `${item.name}(${item.inputs.map(i => i.type).join(',')})`,
                reason: `State-modifying function (${item.stateMutability}) - not applicable for read-only snapshotting`,
                category: 'NOT_APPLICABLE'
            });
            continue;
        }

        const signature = `${item.name}(${item.inputs.map(i => i.type).join(',')})`;

        // Check if scenario explicitly ignores/skips this read-only function
        if (ignoreFunctions.includes(item.name) || ignoreFunctions.includes('*')) {
            skippedReadOnly.push({
                name: item.name,
                signature,
                reason: 'Function ignored or skipped via scenario configuration',
                category: 'SCENARIO_IGNORED'
            });
            continue;
        }

        // EIP-1822 / UUPS internal implementation check: reverts on proxy delegatecall by design
        if (item.name === 'proxiableUUID') {
            skippedReadOnly.push({
                name: item.name,
                signature,
                reason: 'UUPS implementation-only check (reverts when called via proxy delegatecall by design)',
                category: 'IMPLEMENTATION_ONLY'
            });
            continue;
        }

        // Case 1: Zero-argument function
        if (item.inputs.length === 0) {
            eligibleCalls.push({
                functionName: item.name,
                signature,
                args: [],
                actorLabel: 'GLOBAL',
                actorAddress: null,
                abiItem: item
            });
        }
        // Case 2: Single address argument (e.g. balance, stake, reward checks per actor)
        else if (item.inputs.length === 1 && item.inputs[0].type === 'address') {
            if (actors.length === 0) {
                skippedReadOnly.push({
                    name: item.name,
                    signature,
                    reason: 'Requires address parameter but no actors configured in scenario',
                    category: 'UNBOUND_ARGUMENTS'
                });
            } else {
                for (const actor of actors) {
                    eligibleCalls.push({
                        functionName: item.name,
                        signature,
                        args: [actor.address],
                        actorLabel: actor.name,
                        actorAddress: actor.address,
                        abiItem: item
                    });
                }
            }
        }
        // Case 3: Functions with complex/multiple parameters not explicitly configured
        else {
            skippedReadOnly.push({
                name: item.name,
                signature,
                reason: `Multi-argument function (${item.inputs.map(i => `${i.type} ${i.name}`).join(', ')}) requires explicit scenario argument mapping`,
                category: 'COMPLEX_SIGNATURE'
            });
        }
    }

    const distinctEligible = new Set(eligibleCalls.map(c => c.functionName)).size;
    const viewPureCount = abi.filter(item => item.type === 'function' && (item.stateMutability === 'view' || item.stateMutability === 'pure')).length;
    const coveragePercent = viewPureCount > 0 ? ((distinctEligible / viewPureCount) * 100).toFixed(1) : 0;

    return {
        contractName: path.basename(artifactPath, '.json'),
        totalFunctions: totalFunctions.length,
        viewPureCount,
        eligibleCalls,
        skippedReadOnly,
        nonViewFunctions,
        coverageStats: {
            totalFunctions: totalFunctions.length,
            readOnlyFunctions: viewPureCount,
            coveredReadOnlyFunctions: distinctEligible,
            skippedReadOnlyFunctions: viewPureCount - distinctEligible,
            nonViewFunctionsCount: nonViewFunctions.length,
            coveragePercent: `${coveragePercent}%`,
            summaryString: `${distinctEligible} of ${viewPureCount} read-only functions covered`
        }
    };
}
