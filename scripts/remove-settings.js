#!/usr/bin/env node
// Removes Token Tracker entries from Claude Code settings.json
// Called by uninstall.bat

const fs = require('fs');

const settingsPath = process.argv[2];
if (!settingsPath || !fs.existsSync(settingsPath)) { process.exit(0); }

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch { process.exit(1); }

// Backup
fs.writeFileSync(settingsPath + '.bak', JSON.stringify(settings, null, 2));

// Remove Token Tracker entries
delete settings.statusLine;
if (settings.hooks) {
  delete settings.hooks.Stop;
  delete settings.hooks.StopFailure;
  delete settings.hooks.UserPromptSubmit;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log('Settings cleaned up.');
