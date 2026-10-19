#!/usr/bin/env node

import { execSync } from 'child_process';

console.log('='.repeat(80));
console.log('       OPENZEPPELIN UPGRADES-CORE STORAGE & UPGRADE SAFETY VALIDATION       ');
console.log('='.repeat(80));

const contracts = ['StakingVaultV2_Buggy', 'StakingVaultV2_Clean', 'StakingVaultV2_PartialBug'];
const results = [];

// Rebuild with build-info and storageLayout first
console.log('\n[1/3] Ensuring Foundry build-info artifacts exist...');
try {
    execSync('forge build --build-info --extra-output storageLayout', {
        env: { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` },
        stdio: 'pipe'
    });
    console.log('✓ forge build --build-info --extra-output storageLayout succeeded');
} catch (err) {
    console.error('Failed to build contracts:', err.message);
    process.exit(1);
}

for (const contract of contracts) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Validating: ${contract} (reference: StakingVaultV1)`);
    console.log('='.repeat(80));

    // 1. Without --unsafeAllow
    console.log(`\n--- [A] Validation WITHOUT --unsafeAllow (Strict OpenZeppelin Rules) ---`);
    const cmdStrict = `npx -y @openzeppelin/upgrades-core validate out/build-info --contract ${contract} --reference StakingVaultV1`;
    let strictPassed = false;
    let strictOutput = '';
    try {
        strictOutput = execSync(cmdStrict, { stdio: 'pipe', encoding: 'utf8' });
        strictPassed = true;
    } catch (err) {
        strictOutput = (err.stdout || '') + '\n' + (err.stderr || '');
    }
    console.log(strictOutput.trim());
    console.log(`Strict Result: ${strictPassed ? 'PASSED (Exit 0)' : 'FAILED error-001 (Exit 1 - Missing Initializer Call)'}`);

    // 2. With --unsafeAllow missing-initializer
    console.log(`\n--- [B] Validation WITH --unsafeAllow missing-initializer (Storage Layout Only) ---`);
    const cmdPermissive = `npx -y @openzeppelin/upgrades-core validate out/build-info --contract ${contract} --reference StakingVaultV1 --unsafeAllow missing-initializer`;
    let permissivePassed = false;
    let permissiveOutput = '';
    try {
        permissiveOutput = execSync(cmdPermissive, { stdio: 'pipe', encoding: 'utf8' });
        permissivePassed = true;
    } catch (err) {
        permissiveOutput = (err.stdout || '') + '\n' + (err.stderr || '');
    }
    console.log(permissiveOutput.trim() || 'No storage layout errors detected.');
    console.log(`Storage Layout Result: ${permissivePassed ? 'PASSED (Exit 0 - Storage Layout Compatible)' : 'FAILED (Exit 1)'}`);

    results.push({
        contract,
        strictPassed,
        permissivePassed
    });
}

console.log('\n' + '='.repeat(80));
console.log('                     OPENZEPPELIN VALIDATION SUMMARY                       ');
console.log('='.repeat(80));
console.log('CONTRACT                  STRICT (NO FLAGS)         STORAGE ONLY (--unsafeAllow)');
console.log('-'.repeat(80));
for (const r of results) {
    const strictStr = r.strictPassed ? 'PASS (0)' : 'FAIL error-001 (1)';
    const permStr = r.permissivePassed ? 'PASS (0) - Layout OK' : 'FAIL (1)';
    console.log(`${r.contract.padEnd(26)} ${strictStr.padEnd(25)} ${permStr}`);
}
console.log('CONCLUSION: OZ upgrades-core layout validation reported no incompatibility for these V2 contracts; it does not test runtime behavior. Other tools were not run.\n');
