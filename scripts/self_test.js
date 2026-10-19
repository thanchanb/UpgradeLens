#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const FOUNDRY_PATH = `${process.env.HOME}/.foundry/bin:${process.env.PATH}`;
const results = [];

function runStep({ name, command, args, expectCode, validateFn }) {
    process.stdout.write(`  ▶ Running: ${name}... `);
    const start = Date.now();
    const proc = spawnSync(command, args, {
        encoding: 'utf8',
        env: { ...process.env, PATH: FOUNDRY_PATH }
    });
    const elapsed = Date.now() - start;
    const actualCode = proc.status ?? (proc.signal ? 1 : 0);
    const stdout = proc.stdout || '';
    const stderr = proc.stderr || '';
    const combinedOutput = stdout + '\n' + stderr;

    let passed = actualCode === expectCode;
    let detail = `Exited with ${actualCode} (expected ${expectCode})`;

    if (passed && validateFn) {
        try {
            const valResult = validateFn(combinedOutput, actualCode);
            if (!valResult.ok) {
                passed = false;
                detail = valResult.reason;
            } else {
                detail = valResult.detail || detail;
            }
        } catch (e) {
            passed = false;
            detail = `Validation error: ${e.message}`;
        }
    } else if (!passed) {
        detail = `Exit code mismatch (got ${actualCode}, expected ${expectCode})`;
    }

    if (passed) {
        console.log(`\x1b[32mPASS\x1b[0m (${elapsed}ms)`);
    } else {
        console.log(`\x1b[31mFAIL\x1b[0m (${elapsed}ms) - ${detail}`);
    }

    results.push({
        name,
        expectCode,
        actualCode,
        passed,
        elapsed: `${elapsed}ms`,
        detail
    });
}

console.log('='.repeat(85));
console.log('                     UPGRADELENS FULL SELF-TEST SUITE                        ');
console.log('='.repeat(85));

// 1. Forge Build and Test
runStep({
    name: '1. Forge Build & Test (Unit Contracts)',
    command: 'forge',
    args: ['test', '-vv'],
    expectCode: 0,
    validateFn: (output) => {
        const ok = output.includes('Suite result: ok. 3 passed; 0 failed');
        return { ok, detail: '3/3 Foundry contract tests passed' };
    }
});

// 2. Buggy Upgrade Scenario
runStep({
    name: '2. Buggy Upgrade Scenario (Uninitialized State)',
    command: 'node',
    args: ['./bin/upgradelens.js', '--config', 'scenarios/buggy_upgrade.json'],
    expectCode: 1,
    validateFn: (output) => {
        const report = JSON.parse(fs.readFileSync('reports/buggy_upgrade_report.json', 'utf8'));
        const ok = report.verdict === 'UNEXPECTED REGRESSION DETECTED' && report.summary.regressionCount === 6;
        return { ok, detail: `Detected ${report.summary.regressionCount} regressions (Alice, Bob, Charlie rewards + eligibility)` };
    }
});

// 3. Partial-Bug Upgrade Scenario
runStep({
    name: '3. Partial-Bug Upgrade Scenario (Charlie Only)',
    command: 'node',
    args: ['./bin/upgradelens.js', '--config', 'scenarios/partial_bug_upgrade.json'],
    expectCode: 1,
    validateFn: (output) => {
        const report = JSON.parse(fs.readFileSync('reports/partial_bug_upgrade_report.json', 'utf8'));
        const charlieRegs = report.comparisons.filter(c => c.status === 'UNEXPECTED REGRESSION' && c.actorLabel === 'charlie');
        const otherRegs = report.comparisons.filter(c => c.status === 'UNEXPECTED REGRESSION' && c.actorLabel !== 'charlie');
        const ok = charlieRegs.length > 0 && otherRegs.length === 0 && report.summary.expectedChangeCount >= 2;
        return { ok, detail: `Targeted regression: flagged only Charlie (${charlieRegs.length} issues), Alice/Bob approved` };
    }
});

// 4. Clean Upgrade Scenario
runStep({
    name: '4. Clean Control Scenario (Backward-Compatible)',
    command: 'node',
    args: ['./bin/upgradelens.js', '--config', 'scenarios/clean_upgrade.json'],
    expectCode: 0,
    validateFn: (output) => {
        const report = JSON.parse(fs.readFileSync('reports/clean_upgrade_report.json', 'utf8'));
        const ok = report.verdict === 'ALL CHECKS PASSED OR APPROVED' && report.summary.regressionCount === 0;
        return { ok, detail: `All checks passed: 0 regressions, ${report.summary.expectedChangeCount} approved changes` };
    }
});

// 5. Wrong Expected Value Scenario
runStep({
    name: '5. Wrong Expected Value Scenario (Strict Matcher)',
    command: 'node',
    args: ['./bin/upgradelens.js', '--config', 'scenarios/clean_charlie_wrongly_zeroed.json'],
    expectCode: 1,
    validateFn: (output) => {
        const report = JSON.parse(fs.readFileSync('reports/clean_charlie_wrongly_zeroed_report.json', 'utf8'));
        const ok = report.summary.regressionCount >= 1 && report.comparisons.some(c => c.status === 'UNEXPECTED REGRESSION');
        return { ok, detail: 'Strict matcher correctly flagged unauthorized/zero expectation' };
    }
});

// 6. All-Skipped Scenario (Zero Coverage Failure)
runStep({
    name: '6. All-Skipped Calls Scenario (Zero Coverage Check)',
    command: 'node',
    args: ['./bin/upgradelens.js', '--config', 'scenarios/all_skipped_test.json'],
    expectCode: 1,
    validateFn: (output) => {
        const report = JSON.parse(fs.readFileSync('reports/all_skipped_test_report.json', 'utf8'));
        const ok = report.verdict === 'NO ELIGIBLE OBSERVATIONS EVALUATED (ZERO COVERAGE)' && report.summary.totalObservedCalls === 0;
        return { ok, detail: 'Correctly rejected zero observations evaluated as failure' };
    }
});

// 7a. Negative Test: Missing actorLabel
runStep({
    name: '7a. Negative Config: Missing actorLabel',
    command: 'node',
    args: ['./bin/upgradelens.js', '--config', 'scenarios/invalid_config_no_actor.json'],
    expectCode: 1,
    validateFn: (output) => {
        const ok = output.includes("'actorLabel' is required");
        return { ok, detail: "Config validation rejected missing 'actorLabel' with clear error" };
    }
});

// 7b. Negative Test: Missing File
runStep({
    name: '7b. Negative Config: Missing File',
    command: 'node',
    args: ['./bin/upgradelens.js', '--config', 'scenarios/non_existent.json'],
    expectCode: 1,
    validateFn: (output) => {
        const ok = output.includes('Scenario file not found');
        return { ok, detail: 'Rejected non-existent scenario with clear error' };
    }
});

// 7c. Negative Test: Malformed JSON
runStep({
    name: '7c. Negative Config: Malformed JSON',
    command: 'node',
    args: ['./bin/upgradelens.js', '--config', 'scenarios/malformed_test.json'],
    expectCode: 1,
    validateFn: (output) => {
        const ok = output.includes('Failed to parse scenario JSON');
        return { ok, detail: 'Rejected malformed JSON with clear error' };
    }
});

// 7d. Negative Test: Unreachable RPC
// Confirm no process is listening on high port 59999 first
const lsofCheck = spawnSync('lsof', ['-i', ':59999'], { encoding: 'utf8' });
const portIsFree = lsofCheck.status === 1;

runStep({
    name: '7d. Negative Network: Unreachable RPC (Port 59999)',
    command: 'node',
    args: ['./bin/upgradelens.js', '--config', 'scenarios/clean_upgrade.json', '--rpc', 'http://127.0.0.1:59999'],
    expectCode: 1,
    validateFn: (output) => {
        if (!portIsFree) {
            return { ok: false, reason: 'High port 59999 was unexpectedly in use before test' };
        }
        const ok = output.includes('Timeout waiting for Anvil RPC');
        return { ok, detail: 'Confirmed port 59999 closed; rejected unreachable RPC with connection timeout' };
    }
});

// Summary Table
console.log('\n' + '='.repeat(85));
console.log('                          SELF-TEST RESULTS SUMMARY                          ');
console.log('='.repeat(85));
console.log('TEST SUITE STEP                                  EXPECT  ACTUAL  RESULT  DETAILS');
console.log('-'.repeat(85));

let allPassed = true;
for (const r of results) {
    if (!r.passed) allPassed = false;
    const nameStr = r.name.padEnd(48);
    const expStr = String(r.expectCode).padEnd(7);
    const actStr = String(r.actualCode).padEnd(7);
    const statusStr = r.passed ? '\x1b[32mPASS\x1b[0m   ' : '\x1b[31mFAIL\x1b[0m   ';
    console.log(`${nameStr} ${expStr} ${actStr} ${statusStr} ${r.detail}`);
}

console.log('='.repeat(85));
if (allPassed) {
    console.log('\x1b[32m\x1b[1mOVERALL STATUS: ALL 10 SELF-TEST STEPS PASSED VERIFIED\x1b[0m\n');
    process.exit(0);
} else {
    console.log('\x1b[31m\x1b[1mOVERALL STATUS: ONE OR MORE SELF-TEST STEPS FAILED\x1b[0m\n');
    process.exit(1);
}
