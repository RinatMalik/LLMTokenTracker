
# Claude Token Tracker

Track your Claude Code token usage in real time. Get Windows desktop notifications before you hit your rate limits, and analyse your usage patterns to find the best times to work.

Built entirely on Claude Code's native statusline and hooks system — no external dependencies, no accounts, no servers. Everything runs locally using Node.js.

---

## Features

- **Live statusline** inside Claude Code showing 5-hour and 7-day usage with reset countdowns
- **Desktop toast notifications** at 60%, 80%, and 90% usage thresholds
- **Pre-prompt warning** injected into context when you're above 85%
- **Immediate alert** if you actually hit the rate limit
- **Usage log** that records every interaction to `~/.claude/usage-log.jsonl`
- **CLI dashboard** with daily/weekly breakdowns and hourly heatmaps
- **GUI dashboard** that opens in your browser with charts and gauges
- **Tokens-per-1% analysis** — see how many tokens it costs to consume 1% of your limit, and whether it varies by time of day or day of week

---

## Requirements

- [Claude Code](https://claude.ai/download) desktop app (Pro or Max plan — rate limit data is only available to subscribers)
- [Node.js](https://nodejs.org) v18 or later
- Windows 10/11

---

## Installation

1. Clone or download this repo
2. Double-click **`install.bat`**
3. Restart Claude Code

That's it. The statusline and hooks activate automatically on your next session.

---

## Usage

### Statusline
After the first response in any Claude Code session, you'll see usage data at the bottom:

```
5h: 23.4% (3h12m) | 7d: 41.0% (4d8h) | Last: 1.2k in / 0.8k out | $0.034
```

Color coding: green (< 60%) → yellow (60–79%) → red (80%+) → bold red (90%+)

### Dashboard (CLI)

From CMD:
```cmd
"%USERPROFILE%\.claude\usage-dashboard.bat"
"%USERPROFILE%\.claude\usage-dashboard.bat" --today
"%USERPROFILE%\.claude\usage-dashboard.bat" --efficiency
```

From Git Bash:
```bash
node ~/.claude/usage-dashboard.js
node ~/.claude/usage-dashboard.js --today
node ~/.claude/usage-dashboard.js --efficiency
```

| Flag | Description |
|------|-------------|
| *(none)* | Weekly summary + tokens-per-1% analysis |
| `--today` | Today's breakdown |
| `--week` | Last 7 days |
| `--hourly` | Hourly heatmap |
| `--efficiency` | Tokens-per-1% deep dive |
| `--gui` | Open browser dashboard with charts |
| `--json` | Raw JSON output |

### Dashboard (GUI)

```cmd
"%USERPROFILE%\.claude\usage-dashboard.bat" --gui
```

Opens a browser dashboard with:
- Gauge rings for 5h and 7d usage
- Tokens-per-1% stats and budget planner
- Hourly variation bars (which hours are cheapest)
- Day-of-week variation bars
- Daily stacked bar chart
- Hourly heatmap (hours × dates)
- Tokens/1% trend lines for both windows

---

## How it works

Claude Code exposes session data (including rate limit percentages) to statusline scripts via stdin after every response. This project uses that data to:

1. **Display** live usage in the statusline
2. **Write** a state file (`/tmp/claude-usage-state.json`) after each interaction
3. **Append** a log entry to `~/.claude/usage-log.jsonl`
4. **Check** thresholds via a `Stop` hook and fire Windows toast notifications
5. **Warn** before a prompt via a `UserPromptSubmit` hook

The dashboard reads the log file and computes analytics locally — your data never leaves your machine.

---

## File structure

```
Token Tracker/
├── install.bat           # Run this to install
├── uninstall.bat         # Run this to remove
├── src/
│   ├── statusline-usage.js     # Statusline display + logger
│   ├── statusline-usage.sh     # Bash wrapper for statusline
│   ├── usage-dashboard.js      # CLI + GUI dashboard
│   ├── usage-dashboard.bat     # Windows CMD wrapper
│   ├── settings-snippet.json   # The settings.json changes (for reference)
│   └── hooks/
│       ├── usage-notify.js     # Threshold notification logic
│       ├── usage-notify.sh     # Bash wrapper
│       ├── usage-precheck.js   # Pre-prompt warning
│       ├── usage-precheck.sh   # Bash wrapper
│       └── rate-limit-hit.sh   # Rate limit hit notification
└── scripts/
    ├── merge-settings.js   # Used by install.bat
    └── remove-settings.js  # Used by uninstall.bat
```

After installation, files are copied to `~/.claude/` and `~/.claude/hooks/`.

---

## Uninstall

Double-click **`uninstall.bat`**. Your usage log (`~/.claude/usage-log.jsonl`) is kept — delete it manually if you want to clear your history.

---

## Notes

- Rate limit data (`five_hour_pct`, `seven_day_pct`) is only available on Claude Pro/Max plans after the first API response in a session
- The tokens-per-1% analysis needs a few days of data before patterns become meaningful
- Sample data used during development is not included — the log starts empty and fills as you use Claude Code

---
![Clause Usage Tracker](https://github.com/user-attachments/assets/d3b8db89-ada5-4ebe-98a4-c844665e9c96)
