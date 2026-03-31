#!/usr/bin/env node
// Merges Token Tracker config into Claude Code settings.json
// Called by install.bat

const fs = require('fs');
const path = require('path');

const settingsPath = process.argv[2];
if (!settingsPath) { console.error('Usage: merge-settings.js <settings.json path>'); process.exit(1); }

const snippet = {
  statusLine: {
    type: 'command',
    command: 'bash ~/.claude/statusline-usage.sh'
  },
  hooks: {
    Stop: [{
      hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/usage-notify.sh', timeout: 10000 }]
    }],
    StopFailure: [{
      matcher: 'rate_limit',
      hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/rate-limit-hit.sh', timeout: 10000 }]
    }],
    UserPromptSubmit: [{
      hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/usage-precheck.sh', timeout: 5000 }]
    }]
  }
};

let existing = {};
if (fs.existsSync(settingsPath)) {
  try {
    existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    console.error('Could not parse existing settings.json');
    process.exit(1);
  }
}

// Backup first
const backup = settingsPath + '.bak';
fs.writeFileSync(backup, JSON.stringify(existing, null, 2));

// Merge (Token Tracker entries win on conflict)
const merged = { ...existing, ...snippet };

// Preserve any existing hooks not from Token Tracker
if (existing.hooks) {
  const ttHookKeys = ['Stop', 'StopFailure', 'UserPromptSubmit'];
  for (const [key, val] of Object.entries(existing.hooks)) {
    if (!ttHookKeys.includes(key)) {
      merged.hooks[key] = val;
    }
  }
}

fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
console.log('Settings merged. Backup saved to: ' + backup);
