#!/usr/bin/env node

// Claude Code UserPromptSubmit Hook - Pre-prompt usage warning
// If usage > 85%, injects a warning into the conversation context

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_FILE = path.join(os.tmpdir(), 'claude-usage-state.json');

function formatDuration(resetEpoch) {
  const now = Math.floor(Date.now() / 1000);
  let diff = resetEpoch - now;
  if (diff <= 0) return 'now';
  const hours = Math.floor(diff / 3600);
  diff %= 3600;
  const mins = Math.floor(diff / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function main() {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    // No state file yet - first interaction, nothing to warn about
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const warnings = [];

  if (state.five_hour_pct != null && state.five_hour_pct >= 85) {
    const resetStr = state.five_hour_resets_at
      ? ` Resets in ${formatDuration(state.five_hour_resets_at)}.`
      : '';
    warnings.push(`5-hour usage at ${state.five_hour_pct.toFixed(1)}%.${resetStr}`);
  }

  if (state.seven_day_pct != null && state.seven_day_pct >= 85) {
    const resetStr = state.seven_day_resets_at
      ? ` Resets in ${formatDuration(state.seven_day_resets_at)}.`
      : '';
    warnings.push(`7-day usage at ${state.seven_day_pct.toFixed(1)}%.${resetStr}`);
  }

  if (warnings.length > 0) {
    const result = {
      additionalContext: `\u26a0\ufe0f USAGE WARNING: ${warnings.join(' ')} Consider keeping this interaction concise to avoid hitting the limit.`
    };
    process.stdout.write(JSON.stringify(result));
  } else {
    process.stdout.write(JSON.stringify({}));
  }
}

main();
