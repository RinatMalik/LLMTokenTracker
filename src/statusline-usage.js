#!/usr/bin/env node

// Claude Code Statusline - Usage Display + Logger
// Reads session JSON from stdin, displays color-coded usage, logs to JSONL

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_FILE = path.join(os.tmpdir(), 'claude-usage-state.json');
const LOG_FILE = path.join(os.homedir(), '.claude', 'usage-log.jsonl');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    // Timeout after 2 seconds if no stdin
    setTimeout(() => resolve(data), 2000);
  });
}

function formatDuration(resetEpoch) {
  const now = Math.floor(Date.now() / 1000);
  let diff = resetEpoch - now;
  if (diff <= 0) return 'now';

  const days = Math.floor(diff / 86400);
  diff %= 86400;
  const hours = Math.floor(diff / 3600);
  diff %= 3600;
  const mins = Math.floor(diff / 60);

  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

function formatTokens(n) {
  if (n == null) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function colorForPct(pct) {
  if (pct >= 90) return '\x1b[1;91m'; // bold bright red
  if (pct >= 80) return '\x1b[31m';   // red
  if (pct >= 60) return '\x1b[33m';   // yellow
  return '\x1b[32m';                   // green
}

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

function readPreviousState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  const tmpFile = STATE_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state));
  fs.renameSync(tmpFile, STATE_FILE);
}

function appendLog(entry) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Silently fail - don't break statusline for logging issues
  }
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stdout.write(`${DIM}Waiting for first response...${RESET}`);
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    process.stdout.write(`${DIM}Usage data unavailable${RESET}`);
    return;
  }

  const rl = data.rate_limits || {};
  const cw = data.context_window || {};
  const cost = data.cost || {};
  const cu = cw.current_usage || {};

  const fiveHour = rl.five_hour || {};
  const sevenDay = rl.seven_day || {};

  const fhPct = fiveHour.used_percentage;
  const sdPct = sevenDay.used_percentage;
  const fhReset = fiveHour.resets_at;
  const sdReset = sevenDay.resets_at;

  const inputTokens = cu.input_tokens || 0;
  const outputTokens = cu.output_tokens || 0;
  const cacheCreation = cu.cache_creation_input_tokens || 0;
  const cacheRead = cu.cache_read_input_tokens || 0;
  const sessionCost = cost.total_cost_usd;

  // Build statusline output
  const parts = [];

  if (fhPct != null) {
    const c = colorForPct(fhPct);
    const resetStr = fhReset ? ` (${formatDuration(fhReset)})` : '';
    parts.push(`${c}5h: ${fhPct.toFixed(1)}%${resetStr}${RESET}`);
  }

  if (sdPct != null) {
    const c = colorForPct(sdPct);
    const resetStr = sdReset ? ` (${formatDuration(sdReset)})` : '';
    parts.push(`${c}7d: ${sdPct.toFixed(1)}%${resetStr}${RESET}`);
  }

  if (inputTokens || outputTokens) {
    parts.push(`${DIM}Last: ${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out${RESET}`);
  }

  if (sessionCost != null) {
    parts.push(`${DIM}$${sessionCost.toFixed(3)}${RESET}`);
  }

  if (parts.length === 0) {
    process.stdout.write(`${DIM}Usage data pending...${RESET}`);
    return;
  }

  process.stdout.write(parts.join(' | '));

  // Write state file for hooks to read
  const prevState = readPreviousState();
  const currentState = {
    five_hour_pct: fhPct,
    seven_day_pct: sdPct,
    five_hour_resets_at: fhReset,
    seven_day_resets_at: sdReset,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_tokens: cacheCreation,
    cache_read_tokens: cacheRead,
    session_cost_usd: sessionCost,
    timestamp: new Date().toISOString()
  };
  writeState(currentState);

  // Calculate deltas and log
  let fhDelta = null;
  let sdDelta = null;
  if (prevState) {
    if (fhPct != null && prevState.five_hour_pct != null) {
      // Only compute delta if same reset window
      if (prevState.five_hour_resets_at === fhReset) {
        fhDelta = fhPct - prevState.five_hour_pct;
      }
    }
    if (sdPct != null && prevState.seven_day_pct != null) {
      if (prevState.seven_day_resets_at === sdReset) {
        sdDelta = sdPct - prevState.seven_day_pct;
      }
    }
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_tokens: cacheCreation,
    cache_read_tokens: cacheRead,
    five_hour_pct: fhPct,
    seven_day_pct: sdPct,
    five_hour_delta_pct: fhDelta != null ? Math.round(fhDelta * 100) / 100 : null,
    seven_day_delta_pct: sdDelta != null ? Math.round(sdDelta * 100) / 100 : null,
    five_hour_resets_at: fhReset,
    seven_day_resets_at: sdReset,
    session_cost_usd: sessionCost
  };

  appendLog(logEntry);
}

main().catch(() => {
  process.stdout.write('Usage: error');
});
