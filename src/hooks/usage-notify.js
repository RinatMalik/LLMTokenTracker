#!/usr/bin/env node

// Claude Code Stop Hook - Threshold Notifications
// Reads usage state and sends Windows toast notifications at 60%/80%/90%

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const STATE_FILE = path.join(os.tmpdir(), 'claude-usage-state.json');
const NOTIFIED_FILE = path.join(os.tmpdir(), 'claude-usage-notified.json');

const THRESHOLDS = [
  { level: 90, title: 'Claude Usage Critical!', msg: 'at 90%! Approaching limit.' },
  { level: 80, title: 'Claude Usage Warning', msg: 'at 80%! Consider pacing.' },
  { level: 60, title: 'Claude Usage Notice', msg: 'at 60%. Monitor your usage.' },
];

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

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

function sendToast(title, message) {
  // Escape single quotes for PowerShell
  const safeTitle = title.replace(/'/g, "''");
  const safeMsg = message.replace(/'/g, "''");

  const ps = `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    $template = @"
    <toast duration="long">
      <visual>
        <binding template="ToastGeneric">
          <text>${safeTitle}</text>
          <text>${safeMsg}</text>
        </binding>
      </visual>
      <audio src="ms-winsoundevent:Notification.Default"/>
    </toast>
"@

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($template)
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
  `;

  try {
    execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, {
      stdio: 'ignore',
      timeout: 8000,
      windowsHide: true
    });
  } catch {
    // Fallback: simpler notification via PowerShell
    try {
      const fallback = `
        Add-Type -AssemblyName System.Windows.Forms;
        $n = New-Object System.Windows.Forms.NotifyIcon;
        $n.Icon = [System.Drawing.SystemIcons]::Warning;
        $n.Visible = $true;
        $n.ShowBalloonTip(5000, '${safeTitle}', '${safeMsg}', 'Warning');
        Start-Sleep -Seconds 6;
        $n.Dispose()
      `;
      execSync(`powershell -NoProfile -Command "${fallback.replace(/"/g, '\\"')}"`, {
        stdio: 'ignore',
        timeout: 10000,
        windowsHide: true
      });
    } catch {
      // Both methods failed, silently continue
    }
  }
}

function checkAndNotify(windowName, pct, resetAt, notified) {
  if (pct == null) return;

  const windowKey = `${windowName}_${resetAt || 'unknown'}`;

  for (const threshold of THRESHOLDS) {
    if (pct >= threshold.level) {
      const notifKey = `${windowKey}_${threshold.level}`;
      if (notified[notifKey]) return; // Already notified for this threshold in this window

      const resetStr = resetAt ? ` Resets in ${formatDuration(resetAt)}.` : '';
      const fullMsg = `${windowName} usage ${threshold.msg}${resetStr}`;
      sendToast(threshold.title, fullMsg);

      // Mark as notified (also mark lower thresholds to avoid cascade)
      for (const t of THRESHOLDS) {
        if (t.level <= threshold.level) {
          notified[`${windowKey}_${t.level}`] = Date.now();
        }
      }
      return; // Only send highest applicable threshold
    }
  }
}

function main() {
  const state = readJSON(STATE_FILE);
  if (!state) return;

  const notified = readJSON(NOTIFIED_FILE) || {};

  checkAndNotify('5-hour', state.five_hour_pct, state.five_hour_resets_at, notified);
  checkAndNotify('7-day', state.seven_day_pct, state.seven_day_resets_at, notified);

  writeJSON(NOTIFIED_FILE, notified);
}

main();
