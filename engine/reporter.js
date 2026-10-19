import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

/**
 * Terminal & JSON Reporter for UpgradeLens.
 */
export function printReport({
    scenario,
    discovery,
    runnerResult,
    comparisonResult,
    outputPath = null
}) {
    const { summary, comparisons, skippedEntries, storageComparisons, verdict, exitCode } = comparisonResult;

    console.log('\n' + chalk.bold.cyan('================================================================================'));
    console.log(chalk.bold.cyan('                          UPGRADELENS REGRESSION REPORT                         '));
    console.log(chalk.bold.cyan('================================================================================'));

    console.log(chalk.bold('Scenario:      ') + chalk.white(scenario.name));
    console.log(chalk.bold('Proxy Address: ') + chalk.yellow(runnerResult.proxyAddress));
    console.log(chalk.bold('V1 Logic:      ') + chalk.gray(runnerResult.v1ImplAddress));
    console.log(chalk.bold('V2 Logic:      ') + chalk.gray(runnerResult.v2ImplAddress));
    console.log(chalk.bold('Actors Tested: ') + chalk.magenta(runnerResult.actors.map(a => `${a.name} (${a.depositEth} ETH)`).join(', ')));

    // 1. Observation Table
    console.log('\n' + chalk.bold.underline('OBSERVATION COMPARISON MATRIX:'));
    console.log(
        padRight('FUNCTION', 24) +
        padRight('ACTOR', 10) +
        padRight('V1 (BEFORE)', 26) +
        padRight('V2 (AFTER)', 26) +
        'STATUS'
    );
    console.log('-'.repeat(105));

    for (const item of comparisons) {
        let statusBadge;
        if (item.status === 'PASS') {
            statusBadge = chalk.bgGreen.black(' PASS ');
        } else if (item.status === 'EXPECTED CHANGE') {
            statusBadge = chalk.bgCyan.black(' EXPECTED CHANGE ');
        } else if (item.status === 'UNEXPECTED REGRESSION') {
            statusBadge = chalk.bgRed.white.bold(' UNEXPECTED REGRESSION ');
        } else if (item.status === 'ERROR') {
            statusBadge = chalk.bgRed.white(' ERROR ');
        } else {
            statusBadge = chalk.bgYellow.black(' SKIPPED ');
        }

        const funcDisplay = truncate(item.functionName, 22);
        const actorDisplay = truncate(item.actorLabel, 9);
        const preDisplay = truncate(String(item.preValue), 24);
        const postDisplay = truncate(String(item.postValue), 24);

        console.log(
            padRight(funcDisplay, 24) +
            padRight(actorDisplay, 10) +
            padRight(preDisplay, 26) +
            padRight(postDisplay, 26) +
            statusBadge
        );

        if (item.status === 'UNEXPECTED REGRESSION' || item.status === 'ERROR') {
            console.log(chalk.red(`   ↳ ${item.reason}`));
        } else if (item.status === 'EXPECTED CHANGE') {
            console.log(chalk.cyan(`   ↳ ${item.reason}`));
        }
    }

    // 2. Storage Preservation Check
    console.log('\n' + chalk.bold.underline('RAW EVM STORAGE PRESERVATION:'));
    for (const s of storageComparisons) {
        const matchBadge = s.status === 'PRESERVED'
            ? chalk.green('✓ PRESERVED')
            : chalk.yellow('⚠ MODIFIED');
        console.log(` Slot ${s.slot}: ${s.preValue} -> ${s.postValue} [${matchBadge}]`);
    }

    // 3. Transparent Coverage Accounting
    console.log('\n' + chalk.bold.underline('ABI COVERAGE TRANSPARENCY:'));
    console.log(` Read-Only Coverage:         ${chalk.green(discovery.coverageStats.summaryString)} (${discovery.coverageStats.coveragePercent})`);
    console.log(` Total ABI Functions:        ${discovery.coverageStats.totalFunctions}`);
    console.log(` Read-Only (view/pure):      ${discovery.coverageStats.readOnlyFunctions}`);
    console.log(` Covered Read-Only:          ${chalk.green(discovery.coverageStats.coveredReadOnlyFunctions)}`);
    console.log(` Skipped Read-Only:          ${chalk.yellow(discovery.coverageStats.skippedReadOnlyFunctions)}`);
    console.log(` Non-View (State-Modifying): ${discovery.coverageStats.nonViewFunctionsCount} (NOT APPLICABLE)`);

    if (skippedEntries.length > 0) {
        console.log(chalk.dim('\n Skipped Read-Only Functions Detail:'));
        for (const skip of skippedEntries) {
            console.log(chalk.dim(`  - ${skip.signature}: ${skip.reason}`));
        }
    }

    if (discovery.nonViewFunctions && discovery.nonViewFunctions.length > 0) {
        console.log(chalk.dim('\n Non-View Functions (Not Applicable for Read-Only Snapshotting):'));
        for (const item of discovery.nonViewFunctions) {
            console.log(chalk.dim(`  - ${item.signature}: ${item.reason}`));
        }
    }

    // 4. Summary & Verdict Banner
    console.log('\n' + chalk.bold.cyan('--------------------------------------------------------------------------------'));
    console.log(chalk.bold('SUMMARY: ') +
        chalk.green(`${summary.passCount} PASS`) + ' | ' +
        chalk.cyan(`${summary.expectedChangeCount} EXPECTED CHANGE`) + ' | ' +
        (summary.regressionCount > 0 ? chalk.red.bold(`${summary.regressionCount} REGRESSION`) : chalk.green('0 REGRESSION')) + ' | ' +
        (summary.errorCount > 0 ? chalk.red.bold(`${summary.errorCount} ERROR`) : chalk.green('0 ERROR')) + ' | ' +
        chalk.yellow(`${summary.skippedReadOnlyCount ?? summary.skippedCount ?? 0} SKIPPED (READ-ONLY)`) + ' | ' +
        chalk.dim(`${summary.nonApplicableCount ?? 0} NOT APPLICABLE (NON-VIEW)`)
    );

    if (exitCode === 0) {
        console.log('\n' + chalk.bgGreen.black.bold(`  VERDICT: ${verdict}  `) + '\n');
    } else {
        console.log('\n' + chalk.bgRed.white.bold(`  VERDICT: ${verdict}  `) + '\n');
    }

    // 5. Machine-readable JSON output
    const reportData = {
        scenario: scenario.name,
        timestamp: new Date().toISOString(),
        proxyAddress: runnerResult.proxyAddress,
        v1ImplAddress: runnerResult.v1ImplAddress,
        v2ImplAddress: runnerResult.v2ImplAddress,
        verdict,
        exitCode,
        summary,
        coverageStats: discovery.coverageStats,
        comparisons,
        skippedEntries,
        storageComparisons
    };

    if (outputPath) {
        const resolvedOut = path.resolve(outputPath);
        fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
        fs.writeFileSync(resolvedOut, JSON.stringify(reportData, null, 2));
        console.log(chalk.dim(`Machine-readable JSON report written to: ${resolvedOut}\n`));
    }

    return reportData;
}

function padRight(str, len) {
    return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 3) + '...' : str;
}
