#!/usr/bin/env node

import path from 'path';
import { loadScenario } from '../engine/scenarioLoader.js';
import { discoverFunctionsFromArtifact } from '../engine/abiDiscovery.js';
import { executeUpgradeScenario } from '../engine/evmRunner.js';
import { compareObservations } from '../engine/comparisonEngine.js';
import { printReport } from '../engine/reporter.js';

async function main() {
    const args = process.argv.slice(2);
    let configPath = 'scenarios/buggy_upgrade.json';
    let outputPath = null;
    let port = 8546;
    let rpcUrl = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--config' || args[i] === '-c') {
            configPath = args[++i];
        } else if (args[i] === '--output' || args[i] === '-o') {
            outputPath = args[++i];
        } else if (args[i] === '--port' || args[i] === '-p') {
            port = parseInt(args[++i], 10);
        } else if (args[i] === '--rpc' || args[i] === '-r') {
            rpcUrl = args[++i];
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
UpgradeLens CLI — Stateful Smart-Contract Upgrade Regression Testing

Usage:
  upgradelens --config <path/to/scenario.json> [options]

Options:
  -c, --config <path>    Path to scenario configuration JSON
  -o, --output <path>    Write machine-readable JSON report to file
  -p, --port <port>      Local Anvil RPC port (default: 8546)
  -r, --rpc <url>        External JSON-RPC URL (overrides local Anvil)
  -h, --help             Show this help message
`);
            process.exit(0);
        }
    }

    try {
        // 1. Load Scenario
        const scenario = loadScenario(configPath);

        // Default output path if not explicitly provided
        if (!outputPath) {
            const scenarioBase = path.basename(configPath, '.json');
            outputPath = `reports/${scenarioBase}_report.json`;
        }

        // 2. Discover Eligible Functions from ABI
        const ignoreList = scenario.skipFunctions || scenario.ignoreFunctions || [];
        const discovery = discoverFunctionsFromArtifact(scenario.v1Artifact, scenario.setup.actors, ignoreList);

        // 3. Execute Scenario in isolated local EVM
        const runnerResult = await executeUpgradeScenario(scenario, discovery.eligibleCalls, port, rpcUrl);

        // 4. Compare Observations
        const comparisonResult = compareObservations({
            preObservations: runnerResult.preUpgradeObservations,
            postObservations: runnerResult.postUpgradeObservations,
            expectedChanges: scenario.expectedChanges,
            skippedReadOnly: discovery.skippedReadOnly,
            nonViewFunctions: discovery.nonViewFunctions,
            preStorageSlots: runnerResult.preStorageSlots,
            postStorageSlots: runnerResult.postStorageSlots
        });

        // 5. Print Terminal Report & Write JSON
        printReport({
            scenario,
            discovery,
            runnerResult,
            comparisonResult,
            outputPath
        });

        // 6. Exit with code (0 on clean/accepted, 1 on regression/error)
        process.exit(comparisonResult.exitCode);
    } catch (err) {
        console.error('\n\x1b[31m[UpgradeLens Fatal Error]\x1b[0m', err.message);
        if (process.env.DEBUG) console.error(err.stack);
        process.exit(1);
    }
}

main();
