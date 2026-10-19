import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

// Strict Allowlist of permitted upgrade scenarios (fixed files, no user strings in command line)
const ALLOWED_SCENARIOS = {
    'buggy_upgrade': path.join(__dirname, 'scenarios', 'buggy_upgrade.json'),
    'clean_upgrade': path.join(__dirname, 'scenarios', 'clean_upgrade.json'),
    'partial_bug_upgrade': path.join(__dirname, 'scenarios', 'partial_bug_upgrade.json')
};

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // CORS headers for local dev flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // 1. API: List scenarios (allowlisted only)
    if (url.pathname === '/api/scenarios' && req.method === 'GET') {
        const scenarios = Object.entries(ALLOWED_SCENARIOS).map(([id, filePath]) => {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
                id,
                file: path.basename(filePath),
                name: content.name,
                description: content.description,
                actors: content.setup?.actors || [],
                advanceTimeSeconds: content.setup?.advanceTimeSeconds || 0,
                expectedChanges: content.expectedChanges || []
            };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(scenarios));
        return;
    }

    // 2. API: Get cached or generated report
    if (url.pathname.startsWith('/api/reports/') && req.method === 'GET') {
        const scenarioId = url.pathname.replace('/api/reports/', '');
        const reportFile = path.join(__dirname, 'reports', `${scenarioId}_report.json`);
        if (fs.existsSync(reportFile)) {
            const reportData = fs.readFileSync(reportFile, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(reportData);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Report not found for ${scenarioId}` }));
        }
        return;
    }

    // 3. API: Run fixed allowlisted upgrade scenario (execFile with fixed arguments)
    if (url.pathname === '/api/run' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body || '{}');
                const scenarioId = data.scenario;
                const scenarioFile = ALLOWED_SCENARIOS[scenarioId];

                // Strict allowlist validation: reject any unauthorized scenario name with 400
                if (!scenarioFile) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: `Scenario '${scenarioId}' is not permitted. Allowed scenarios: ${Object.keys(ALLOWED_SCENARIOS).join(', ')}`
                    }));
                    return;
                }

                // Execute CLI engine using execFile with fixed arguments and NO user-supplied strings
                const cliScript = path.join(__dirname, 'bin', 'upgradelens.js');
                execFile(process.execPath, [cliScript, '--config', scenarioFile], {
                    cwd: __dirname,
                    env: {
                        ...process.env,
                        PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}`,
                        FORCE_COLOR: '0'
                    }
                }, (error, stdout, stderr) => {
                    const exitCode = error ? (error.code || 1) : 0;
                    const reportFile = path.join(__dirname, 'reports', `${scenarioId}_report.json`);
                    let report = null;
                    if (fs.existsSync(reportFile)) {
                        try {
                            report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
                        } catch (_) {}
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        scenarioId,
                        exitCode,
                        stdout: stdout || '',
                        stderr: stderr || '',
                        report
                    }));
                });
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Malformed request: ${err.message}` }));
            }
        });
        return;
    }

    // 4. Static file serving from public/
    let reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
    }
});

server.listen(PORT, HOST, () => {
    console.log(`[UpgradeLens Web Server] Running strictly on http://${HOST}:${PORT}`);
});
