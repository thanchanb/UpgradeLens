/**
 * Comparison Engine for UpgradeLens.
 * Evaluates pre-upgrade vs post-upgrade observations, categorizing results strictly into:
 * - PASS
 * - EXPECTED CHANGE
 * - UNEXPECTED REGRESSION
 * - SKIPPED
 * - ERROR
 */
export function compareObservations({
    preObservations,
    postObservations,
    expectedChanges = [],
    skippedReadOnly = [],
    nonViewFunctions = [],
    skippedFunctions = [],
    preStorageSlots = {},
    postStorageSlots = {}
}) {
    const comparisons = [];
    let passCount = 0;
    let expectedChangeCount = 0;
    let regressionCount = 0;
    let errorCount = 0;

    for (let i = 0; i < preObservations.length; i++) {
        const pre = preObservations[i];
        const post = postObservations[i];
        const call = pre.call;

        // 1. Check for Reverts / Errors
        if (!pre.success || !post.success) {
            errorCount++;
            comparisons.push({
                functionName: call.functionName,
                signature: call.signature,
                actorLabel: call.actorLabel,
                args: call.args,
                preValue: pre.value,
                postValue: post.value,
                preError: pre.error,
                postError: post.error,
                status: 'ERROR',
                reason: `EVM call reverted: pre="${pre.error || 'ok'}", post="${post.error || 'ok'}"`
            });
            continue;
        }

        // 2. Check for Identical Output (PASS)
        if (pre.value === post.value) {
            passCount++;
            comparisons.push({
                functionName: call.functionName,
                signature: call.signature,
                actorLabel: call.actorLabel,
                args: call.args,
                preValue: pre.value,
                postValue: post.value,
                status: 'PASS',
                reason: 'Output strictly identical before and after upgrade'
            });
            continue;
        }

        // 3. Output Differs: Check against Explicit Expected Changes
        // Strict Matcher Rules:
        // - Function Name must match
        // - actorLabel: REQUIRED for actor-specific calls (cannot be omitted if call is actor-specific)
        // - expectedPostValue: if specified, post.value must strictly match
        // - minValue / maxValue bounds: if specified, post.value must be within [minValue, maxValue]
        let matchReason = null;
        let ruleViolation = null;

        const matchedRule = expectedChanges.find(rule => {
            if (rule.functionName !== call.functionName) return false;

            // Enforce actorLabel requirement:
            const isActorSpecific = call.actorLabel && call.actorLabel !== 'GLOBAL';
            if (isActorSpecific) {
                if (!rule.actorLabel || (rule.actorLabel !== call.actorLabel && rule.actorLabel !== '*')) {
                    return false;
                }
            } else if (rule.actorLabel && rule.actorLabel !== 'GLOBAL' && rule.actorLabel !== '*') {
                return false;
            }

            // Args check (if rule specifies args)
            if (rule.args && JSON.stringify(rule.args) !== JSON.stringify(call.args)) {
                return false;
            }

            // Validate expectedPostValue if present
            if (rule.expectedPostValue !== undefined && rule.expectedPostValue !== null) {
                if (String(post.value) !== String(rule.expectedPostValue)) {
                    ruleViolation = `Post-upgrade value '${post.value}' does not match expected '${rule.expectedPostValue}'`;
                    return false;
                }
            }

            // Validate bounds (minValue / maxValue or bound.min / bound.max)
            const minBound = rule.minValue ?? rule.bound?.min;
            const maxBound = rule.maxValue ?? rule.bound?.max;
            if (minBound !== undefined || maxBound !== undefined) {
                try {
                    const postBig = BigInt(post.value);
                    if (minBound !== undefined && postBig < BigInt(minBound)) {
                        ruleViolation = `Post-upgrade value '${post.value}' is below minimum bound '${minBound}'`;
                        return false;
                    }
                    if (maxBound !== undefined && postBig > BigInt(maxBound)) {
                        ruleViolation = `Post-upgrade value '${post.value}' exceeds maximum bound '${maxBound}'`;
                        return false;
                    }
                } catch (e) {
                    ruleViolation = `Bound comparison error: ${e.message}`;
                    return false;
                }
            }

            matchReason = rule.reason || 'Explicitly configured rule';
            return true;
        });

        if (matchedRule && matchedRule.allowed) {
            expectedChangeCount++;
            comparisons.push({
                functionName: call.functionName,
                signature: call.signature,
                actorLabel: call.actorLabel,
                args: call.args,
                preValue: pre.value,
                postValue: post.value,
                status: 'EXPECTED CHANGE',
                reason: `Approved change: ${matchReason}`
            });
        } else {
            regressionCount++;
            const failureDetail = ruleViolation 
                ? ruleViolation 
                : matchedRule && !matchedRule.allowed
                ? `Rule explicitly disallows change (${matchedRule.reason || 'disallowed'})`
                : `Value shifted from '${pre.value}' to '${post.value}' without scenario authorization`;
            comparisons.push({
                functionName: call.functionName,
                signature: call.signature,
                actorLabel: call.actorLabel,
                args: call.args,
                preValue: pre.value,
                postValue: post.value,
                status: 'UNEXPECTED REGRESSION',
                reason: failureDetail
            });
        }
    }

    // 4. Record Skipped Read-Only Functions Transparently
    const skippedEntries = (skippedReadOnly || skippedFunctions || []).map(skip => ({
        functionName: skip.name,
        signature: skip.signature,
        actorLabel: 'N/A',
        args: [],
        preValue: 'N/A',
        postValue: 'N/A',
        status: 'SKIPPED',
        reason: skip.reason
    }));

    // Non-view functions (state-modifying, not applicable for read-only snapshotting)
    const nonApplicableEntries = (nonViewFunctions || []).map(item => ({
        functionName: item.name,
        signature: item.signature,
        status: 'NOT_APPLICABLE',
        reason: item.reason
    }));

    // 5. Compare Storage Layout Preservation
    const storageComparisons = [];
    const allSlots = new Set([...Object.keys(preStorageSlots), ...Object.keys(postStorageSlots)]);
    for (const slot of allSlots) {
        const preVal = preStorageSlots[slot];
        const postVal = postStorageSlots[slot];
        const isMatch = preVal === postVal;
        storageComparisons.push({
            slot: Number(slot),
            preValue: preVal,
            postValue: postVal,
            status: isMatch ? 'PRESERVED' : 'MODIFIED'
        });
    }

    // Determine Overall Verdict & Exit Code
    const hasRegressions = regressionCount > 0;
    const hasErrors = errorCount > 0;
    const hasZeroObservations = comparisons.length === 0;

    const verdict = hasZeroObservations
        ? 'NO ELIGIBLE OBSERVATIONS EVALUATED (ZERO COVERAGE)'
        : hasRegressions
        ? 'UNEXPECTED REGRESSION DETECTED'
        : hasErrors
        ? 'EXECUTION ERRORS ENCOUNTERED'
        : 'ALL CHECKS PASSED OR APPROVED';

    const exitCode = (hasZeroObservations || hasRegressions || hasErrors) ? 1 : 0;

    return {
        verdict,
        exitCode,
        summary: {
            totalObservedCalls: comparisons.length,
            passCount,
            expectedChangeCount,
            regressionCount,
            errorCount,
            skippedReadOnlyCount: skippedEntries.length,
            skippedCount: skippedEntries.length,
            nonApplicableCount: nonApplicableEntries.length
        },
        comparisons,
        skippedEntries,
        nonApplicableEntries,
        storageComparisons
    };
}
