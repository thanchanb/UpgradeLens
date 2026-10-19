// UpgradeLens Frontend Application Logic (2026 Developer Tools Edition)
let activeScenarioId = 'buggy_upgrade';
let currentReport = null;
let activeFilter = 'all';
const expandedRows = new Set();

function init() {
    setupEventListeners();
    loadScenario(activeScenarioId);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function setupEventListeners() {
    // 1. Scenario Selector Switchers
    const pills = document.querySelectorAll('.scenario-selector .pill-btn');
    pills.forEach(btn => {
        btn.addEventListener('click', () => {
            const scenario = btn.getAttribute('data-scenario');
            if (activeScenarioId === scenario) return;

            pills.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');

            activeScenarioId = scenario;
            expandedRows.clear();
            loadScenario(activeScenarioId);
        });
    });

    // 2. Run Verification Button
    const btnRun = document.getElementById('btnRunTest');
    btnRun.addEventListener('click', () => {
        executeLiveVerification(activeScenarioId);
    });

    // 3. Status Filter Buttons
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.getAttribute('data-filter');
            renderObservationTable();
        });
    });

    // 4. Copy JSON Button
    const btnCopy = document.getElementById('btnCopyJson');
    btnCopy.addEventListener('click', () => {
        if (!currentReport) return;
        navigator.clipboard.writeText(JSON.stringify(currentReport, null, 2));
        const originalText = btnCopy.textContent;
        btnCopy.textContent = '✓ Copied to Clipboard';
        setTimeout(() => { btnCopy.textContent = originalText; }, 2000);
    });
}

/**
 * Loads cached report from /api/reports/:id
 */
async function loadScenario(scenarioId) {
    try {
        const res = await fetch(`/api/reports/${scenarioId}`);
        if (res.ok) {
            currentReport = await res.json();
            renderDashboard(currentReport);
        } else {
            // Trigger initial live run if no cached report found
            await executeLiveVerification(scenarioId);
        }
    } catch (err) {
        console.error('Error loading scenario:', err);
    }
}

/**
 * Calls backend /api/run to execute fixed allowlisted scenario
 */
async function executeLiveVerification(scenarioId) {
    const btnRun = document.getElementById('btnRunTest');
    const spinner = document.getElementById('runSpinner');
    const icon = document.getElementById('runBtnIcon');
    const text = document.getElementById('runBtnText');

    btnRun.disabled = true;
    spinner.classList.remove('hidden');
    icon.classList.add('hidden');
    text.textContent = 'Executing EVM Upgrade...';

    const terminalEl = document.getElementById('terminalOutput');
    terminalEl.textContent = `[UpgradeLens CLI Runner]\nExecuting allowlisted scenario: ${scenarioId}...\nSpawning Anvil node on 127.0.0.1, deploying V1, capturing pre-state, executing UUPS upgrade, evaluating observations...`;

    try {
        const res = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenario: scenarioId })
        });

        const data = await res.json();
        if (data.report) {
            currentReport = data.report;
            renderDashboard(currentReport);
        }

        if (data.stdout) {
            terminalEl.textContent = data.stdout;
        } else if (data.message) {
            terminalEl.textContent = `[UpgradeLens Server Status]\n${data.message}`;
        }
    } catch (err) {
        terminalEl.textContent = `Execution failed: ${err.message}`;
    } finally {
        btnRun.disabled = false;
        spinner.classList.add('hidden');
        icon.classList.remove('hidden');
        text.textContent = 'Run Verification';
    }
}

/**
 * Renders all dashboard elements from verified JSON report
 */
function renderDashboard(report) {
    if (!report) return;

    // 1. Verdict Banner Styling
    const banner = document.getElementById('verdictBanner');
    const badge = document.getElementById('bannerBadge');
    const exitTag = document.getElementById('bannerExitCode');

    banner.classList.remove('verdict-pass', 'verdict-regression', 'verdict-warn');

    if (report.exitCode === 0) {
        banner.classList.add('verdict-pass');
        badge.className = 'badge badge-pass';
        badge.textContent = 'ALL CHECKS PASSED';
    } else if (report.verdict.includes('ZERO COVERAGE')) {
        banner.classList.add('verdict-warn');
        badge.className = 'badge badge-skipped';
        badge.textContent = 'ZERO COVERAGE (FAILED)';
    } else {
        banner.classList.add('verdict-regression');
        badge.className = 'badge badge-regression';
        badge.textContent = 'REGRESSION DETECTED';
    }

    exitTag.textContent = `Process Exit: ${report.exitCode}`;

    // 2. Scenario Metadata
    document.getElementById('scenarioTitle').textContent = report.scenario || 'Smart Contract Upgrade';
    document.getElementById('scenarioDesc').textContent = report.scenarioDescription ||
        (report.scenario.includes('Clean')
            ? 'Controlled upgrade preserving existing legacy staker state and applying approved loyalty duration bonus.'
            : report.scenario.includes('PartialBug')
            ? 'Realistic tier checkpoint bug that leaves Alice and Bob approved but zeroes Charlie due to an off-by-one stake threshold.'
            : 'Uninitialized state regression causing claimable rewards and eligibility to wipe to zero across legacy users.');

    document.getElementById('valProxyAddress').textContent = shorten(report.proxyAddress);
    document.getElementById('valV1Address').textContent = shorten(report.v1ImplAddress);
    document.getElementById('valV2Address').textContent = shorten(report.v2ImplAddress);
    document.getElementById('valTimestamp').textContent = report.timestamp ? new Date(report.timestamp).toLocaleTimeString() : 'Verified';

    // 3. KPI Cards
    const kpiVerdict = document.getElementById('kpiVerdict');
    const kpiVerdictSub = document.getElementById('kpiVerdictSub');
    const kpiRegressions = document.getElementById('kpiRegressions');
    const kpiRegressionsSub = document.getElementById('kpiRegressionsSub');
    const kpiExpected = document.getElementById('kpiExpected');
    const kpiExpectedSub = document.getElementById('kpiExpectedSub');
    const kpiCoverage = document.getElementById('kpiCoverage');
    const kpiCoverageSub = document.getElementById('kpiCoverageSub');
    const kpiStorage = document.getElementById('kpiStorage');

    if (report.exitCode === 0) {
        kpiVerdict.textContent = 'PASSED';
        kpiVerdict.className = 'kpi-value text-green';
        kpiVerdictSub.textContent = 'Process Exit Code: 0';
    } else {
        kpiVerdict.textContent = 'FAILED';
        kpiVerdict.className = 'kpi-value text-red';
        kpiVerdictSub.textContent = `Process Exit Code: ${report.exitCode}`;
    }

    const regCount = report.summary.regressionCount;
    kpiRegressions.textContent = regCount;
    kpiRegressions.className = regCount > 0 ? 'kpi-value text-red' : 'kpi-value text-green';
    kpiRegressionsSub.textContent = regCount === 0 ? '0 unexpected shifts' : `${regCount} unexpected state shifts`;

    const expCount = report.summary.expectedChangeCount;
    kpiExpected.textContent = expCount;
    kpiExpectedSub.textContent = `${expCount} authorized shifts`;

    kpiCoverage.textContent = report.coverageStats.coveragePercent;
    kpiCoverageSub.textContent = `${report.coverageStats.coveredReadOnlyFunctions} of ${report.coverageStats.readOnlyFunctions} view functions`;

    const preservedCount = (report.storageComparisons || []).filter(s => s.status === 'PRESERVED').length;
    const totalSlots = report.storageComparisons?.length || 5;
    kpiStorage.textContent = `${preservedCount} / ${totalSlots} Slots`;

    // 4. Counts for Filter Buttons
    const comps = report.comparisons || [];
    document.getElementById('countAll').textContent = comps.length;
    document.getElementById('countRegressions').textContent = comps.filter(c => c.status === 'UNEXPECTED REGRESSION').length;
    document.getElementById('countExpected').textContent = comps.filter(c => c.status === 'EXPECTED CHANGE').length;
    document.getElementById('countPassed').textContent = comps.filter(c => c.status === 'PASS').length;

    // 5. Render Observations Table
    renderObservationTable();

    // 6. Render Raw Storage Slots
    renderStorageSlots(report.storageComparisons || []);

    // 7. Render Coverage & Skipped Transparency
    renderCoverageBreakdown(report);

    // 8. Update Terminal Inspector
    document.getElementById('terminalOutput').textContent = JSON.stringify(report, null, 2);
}

/**
 * Renders observation table with status filter and expandable row diagnosis
 */
function renderObservationTable() {
    if (!currentReport) return;
    const tbody = document.getElementById('obsTableBody');
    tbody.innerHTML = '';

    const comps = currentReport.comparisons || [];
    const filtered = activeFilter === 'all'
        ? comps
        : comps.filter(c => c.status === activeFilter);

    if (filtered.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="4" style="text-align: center; color: var(--text-muted); padding: 32px;">No observations match the selected filter '${activeFilter}'.</td>`;
        tbody.appendChild(tr);
        return;
    }

    filtered.forEach((comp, idx) => {
        const rowId = `row-${comp.functionName}-${comp.actorLabel || 'global'}-${idx}`;
        const isExpanded = expandedRows.has(rowId);
        const isRegression = comp.status === 'UNEXPECTED REGRESSION';
        const actorClass = (comp.actorLabel || 'global').toLowerCase();

        const tr = document.createElement('tr');
        tr.className = `obs-row ${isRegression ? 'row-regression' : ''}`;
        tr.setAttribute('tabindex', '0');
        tr.setAttribute('role', 'button');
        tr.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

        let statusBadge = '';
        let reasonHtml = '';

        if (comp.status === 'PASS') {
            statusBadge = '<span class="badge badge-pass">PASS</span>';
        } else if (comp.status === 'EXPECTED CHANGE') {
            statusBadge = '<span class="badge badge-expected">EXPECTED CHANGE</span>';
            reasonHtml = `<div class="diff-reason reason-expected">✓ ${escapeHtml(comp.reason)}</div>`;
        } else if (comp.status === 'UNEXPECTED REGRESSION') {
            statusBadge = '<span class="badge badge-regression">UNEXPECTED REGRESSION</span>';
            reasonHtml = `<div class="diff-reason reason-regression">🚨 ${escapeHtml(comp.reason)}</div>`;
        } else {
            statusBadge = `<span class="badge badge-skipped">${escapeHtml(comp.status)}</span>`;
        }

        tr.innerHTML = `
            <td>
                <div>
                    <span class="actor-chip ${actorClass}">${escapeHtml(comp.actorLabel || 'GLOBAL')}</span>
                    <strong class="mono">${escapeHtml(comp.functionName)}</strong>
                    <span style="color: var(--text-muted); font-size: 11px; margin-left: 6px;">${isExpanded ? '▲' : '▼'}</span>
                </div>
            </td>
            <td class="mono">${formatVal(comp.preValue)}</td>
            <td class="mono">${formatVal(comp.postValue)}</td>
            <td>
                <div>${statusBadge}</div>
                ${reasonHtml}
            </td>
        `;

        tr.addEventListener('click', () => {
            if (expandedRows.has(rowId)) {
                expandedRows.delete(rowId);
            } else {
                expandedRows.add(rowId);
            }
            renderObservationTable();
        });

        tbody.appendChild(tr);

        // Expanded Row Diagnosis
        if (isExpanded) {
            const expTr = document.createElement('tr');
            expTr.className = 'expanded-row';
            expTr.innerHTML = `
                <td colspan="4">
                    <div class="detail-block">
                        <div class="detail-item">
                            <span class="detail-title">Full Signature</span>
                            <span class="mono">${escapeHtml(comp.signature || comp.functionName)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-title">Invocation Arguments</span>
                            <span class="mono">${comp.args && comp.args.length ? JSON.stringify(comp.args) : '[] (None)'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-title">Observation Diagnosis</span>
                            <span>${escapeHtml(comp.reason || 'Output identical before and after upgrade.')}</span>
                        </div>
                    </div>
                </td>
            `;
            tbody.appendChild(expTr);
        }
    });
}

/**
 * Renders raw EVM storage slots inspector
 */
function renderStorageSlots(storageComparisons) {
    const list = document.getElementById('storageSlotList');
    list.innerHTML = '';

    const slotLabels = {
        0: 'Slot 0: totalStaked (uint256)',
        1: 'Slot 1: rewardRatePerSecond (uint256)',
        2: 'Slot 2: stakes (mapping - Slot 2 permanent zero bytes)',
        3: 'Slot 3: lastClaimTimestamp (mapping - Slot 3 zero bytes)',
        4: 'Slot 4: stakedSince (mapping - Appended V2 storage)'
    };

    for (const s of storageComparisons) {
        const isPreserved = s.status === 'PRESERVED';
        const div = document.createElement('div');
        div.className = 'slot-item';
        div.innerHTML = `
            <div>
                <strong>${slotLabels[s.slot] || `Slot ${s.slot}`}</strong>
                <div class="mono" style="color: var(--text-muted); font-size: 11px;">
                    ${s.preValue.slice(0, 18)}... → ${s.postValue.slice(0, 18)}...
                </div>
            </div>
            <div>
                ${isPreserved ? '<span class="badge badge-pass">0 Collisions ✓</span>' : '<span class="badge badge-regression">Modified ⚠</span>'}
            </div>
        `;
        list.appendChild(div);
    }
}

/**
 * Renders ABI coverage transparency breakdown
 */
function renderCoverageBreakdown(report) {
    const container = document.getElementById('coverageBreakdown');
    container.innerHTML = '';

    const stats = report.coverageStats || {};
    const skipped = report.skippedEntries || [];

    const summaryItem = document.createElement('div');
    summaryItem.className = 'coverage-item';
    summaryItem.innerHTML = `
        <div>
            <strong>Read-Only ABI Coverage:</strong>
            <span style="color: var(--text-muted); font-size: 11px;">(view/pure functions snapshot)</span>
        </div>
        <div>
            <strong class="text-cyan">${stats.summaryString || `${stats.coveredReadOnlyFunctions} of ${stats.readOnlyFunctions} covered`}</strong>
            <span class="badge badge-pass" style="margin-left: 6px;">${stats.coveragePercent || '90.0%'}</span>
        </div>
    `;
    container.appendChild(summaryItem);

    if (skipped.length > 0) {
        for (const skip of skipped) {
            const div = document.createElement('div');
            div.className = 'coverage-item';
            div.innerHTML = `
                <div>
                    <span class="mono">⊘ ${escapeHtml(skip.signature || skip.functionName)}</span>
                    <div style="color: var(--text-muted); font-size: 11px;">${escapeHtml(skip.reason)}</div>
                </div>
                <div>
                    <span class="badge badge-skipped">SKIPPED</span>
                </div>
            `;
            container.appendChild(div);
        }
    }

    // List Non-View functions as Not Applicable
    const nonViewItem = document.createElement('div');
    nonViewItem.className = 'coverage-item';
    nonViewItem.innerHTML = `
        <div>
            <span class="mono">⚙ State-Modifying Functions (5 functions)</span>
            <div style="color: var(--text-muted); font-size: 11px;">initialize, stake, renounceOwnership, transferOwnership, upgradeToAndCall</div>
        </div>
        <div>
            <span class="badge badge-skipped">NOT APPLICABLE</span>
        </div>
    `;
    container.appendChild(nonViewItem);
}

function shorten(addr) {
    if (!addr || addr.length < 12) return addr || '--';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatVal(val) {
    if (val === null || val === undefined) return '<span style="color:var(--text-muted)">null</span>';
    if (val === 'true') return '<span style="color:var(--semantic-pass-fg); font-weight:600">true</span>';
    if (val === 'false') return '<span style="color:var(--semantic-fail-fg); font-weight:600">false</span>';
    // Format large wei values to ETH
    if (typeof val === 'string' && val.length > 16 && /^\d+$/.test(val)) {
        try {
            const eth = Number(BigInt(val) / 10n**14n) / 10000;
            return `<span title="${val}">${eth.toFixed(4)} ETH <small style="color:var(--text-muted); font-size: 10px;">(${val.slice(0, 6)}...)</small></span>`;
        } catch (_) {}
    }
    return escapeHtml(String(val));
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
