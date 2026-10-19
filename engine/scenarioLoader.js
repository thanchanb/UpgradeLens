import fs from 'fs';
import path from 'path';

/**
 * Validates and loads UpgradeLens scenario configurations.
 */
export function loadScenario(scenarioPath) {
    const resolvedPath = path.resolve(scenarioPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Scenario file not found: ${resolvedPath}`);
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    let scenario;
    try {
        scenario = JSON.parse(content);
    } catch (err) {
        throw new Error(`Failed to parse scenario JSON at ${resolvedPath}: ${err.message}`);
    }

    // Required fields check
    const required = ['name', 'v1Artifact', 'v2Artifact', 'proxyArtifact', 'setup'];
    for (const field of required) {
        if (!scenario[field]) {
            throw new Error(`Missing required field '${field}' in scenario: ${resolvedPath}`);
        }
    }

    // Resolve artifact paths relative to workspace root if not absolute
    const workspaceRoot = process.cwd();
    scenario.v1Artifact = path.resolve(workspaceRoot, scenario.v1Artifact);
    scenario.v2Artifact = path.resolve(workspaceRoot, scenario.v2Artifact);
    scenario.proxyArtifact = path.resolve(workspaceRoot, scenario.proxyArtifact);

    if (!fs.existsSync(scenario.v1Artifact)) {
        throw new Error(`v1Artifact does not exist: ${scenario.v1Artifact}`);
    }
    if (!fs.existsSync(scenario.v2Artifact)) {
        throw new Error(`v2Artifact does not exist: ${scenario.v2Artifact}`);
    }
    if (!fs.existsSync(scenario.proxyArtifact)) {
        throw new Error(`proxyArtifact does not exist: ${scenario.proxyArtifact}`);
    }

    scenario.expectedChanges = scenario.expectedChanges || [];
    for (let i = 0; i < scenario.expectedChanges.length; i++) {
        const rule = scenario.expectedChanges[i];
        if (!rule.functionName) {
            throw new Error(`Invalid expectedChanges rule at index ${i}: 'functionName' is required.`);
        }
        if (!rule.actorLabel || typeof rule.actorLabel !== 'string' || !rule.actorLabel.trim()) {
            throw new Error(
                `Invalid expectedChanges rule for function '${rule.functionName}': 'actorLabel' is required ` +
                `(must specify an actor name, e.g. 'alice', or 'GLOBAL' for contract-wide views).`
            );
        }
    }

    scenario.setup.advanceTimeSeconds = scenario.setup.advanceTimeSeconds || 0;
    scenario.setup.actors = scenario.setup.actors || [];

    return scenario;
}
