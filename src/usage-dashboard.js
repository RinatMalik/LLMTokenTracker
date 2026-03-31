#!/usr/bin/env node

// Claude Usage Dashboard - Analyze usage-log.jsonl for patterns
// Usage: node usage-dashboard.js [--today|--week|--hourly|--json]

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const LOG_FILE = path.join(os.homedir(), '.claude', 'usage-log.jsonl');

// --- Helpers ---

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

function bar(value, maxValue, width = 20) {
  const filled = Math.round((value / (maxValue || 1)) * width);
  return '\u2588'.repeat(Math.min(filled, width)) + '\u2591'.repeat(width - Math.min(filled, width));
}

function dateStr(d) {
  return d.toISOString().split('T')[0];
}

function dayName(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function hourLabel(h) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${String(hr).padStart(2)}${ampm}`;
}

// --- Data Loading ---

function loadEntries() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('No usage log found. Usage data will be recorded after your first Claude Code interaction.');
    console.log(`Expected location: ${LOG_FILE}`);
    process.exit(0);
  }

  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    try {
      const entry = JSON.parse(line);
      entry._date = new Date(entry.timestamp);
      return entry;
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function filterToday(entries) {
  const today = dateStr(new Date());
  return entries.filter((e) => dateStr(e._date) === today);
}

function filterWeek(entries) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return entries.filter((e) => e._date >= weekAgo);
}

// --- Reports ---

function summarize(entries, label) {
  if (entries.length === 0) {
    console.log(`\n  No data for ${label}.`);
    return null;
  }

  const totalIn = entries.reduce((s, e) => s + (e.input_tokens || 0), 0);
  const totalOut = entries.reduce((s, e) => s + (e.output_tokens || 0), 0);
  const totalCache = entries.reduce((s, e) => s + (e.cache_creation_tokens || 0) + (e.cache_read_tokens || 0), 0);

  // Get latest rate limit values
  const latest = entries[entries.length - 1];
  const fhPct = latest.five_hour_pct;
  const sdPct = latest.seven_day_pct;

  // Sum deltas for rate limit consumption
  const fhConsumed = entries.reduce((s, e) => s + (e.five_hour_delta_pct || 0), 0);
  const sdConsumed = entries.reduce((s, e) => s + (e.seven_day_delta_pct || 0), 0);

  // Cost
  const costs = entries.filter((e) => e.session_cost_usd != null).map((e) => e.session_cost_usd);
  const maxCost = costs.length > 0 ? Math.max(...costs) : null;

  console.log(`\n  ${label}:`);
  console.log(`    Interactions:   ${entries.length}`);
  console.log(`    Total tokens:   ${formatTokens(totalIn)} in / ${formatTokens(totalOut)} out`);
  if (totalCache > 0) {
    console.log(`    Cache tokens:   ${formatTokens(totalCache)}`);
  }
  if (fhPct != null) {
    console.log(`    5h limit now:   ${fhPct.toFixed(1)}% (consumed ~${Math.abs(fhConsumed).toFixed(1)}% in this period)`);
  }
  if (sdPct != null) {
    console.log(`    7d limit now:   ${sdPct.toFixed(1)}% (consumed ~${Math.abs(sdConsumed).toFixed(1)}% in this period)`);
  }
  if (maxCost != null) {
    console.log(`    Session cost:   $${maxCost.toFixed(3)} (max session)`);
  }

  return { totalIn, totalOut, entries };
}

function hourlyBreakdown(entries) {
  if (entries.length === 0) return;

  const hourBuckets = {};
  for (let h = 0; h < 24; h++) hourBuckets[h] = { tokens: 0, count: 0, fhDelta: 0 };

  for (const e of entries) {
    const h = e._date.getHours();
    hourBuckets[h].tokens += (e.input_tokens || 0) + (e.output_tokens || 0);
    hourBuckets[h].count++;
    hourBuckets[h].fhDelta += (e.five_hour_delta_pct || 0);
  }

  const maxTokens = Math.max(...Object.values(hourBuckets).map((b) => b.tokens), 1);
  const activeHours = Object.entries(hourBuckets).filter(([, b]) => b.tokens > 0);

  if (activeHours.length === 0) {
    console.log('\n  No hourly data available.');
    return;
  }

  // Find peak hour
  const peak = activeHours.reduce((best, [h, b]) => b.tokens > best.tokens ? { hour: h, ...b } : best, { tokens: 0 });

  console.log('\n  Hourly Breakdown:');
  console.log('  ────────────────────────────────────────────────────');

  for (let h = 0; h < 24; h++) {
    const b = hourBuckets[h];
    if (b.tokens === 0) continue;

    const label = hourLabel(h);
    const barStr = bar(b.tokens, maxTokens);
    const peakMarker = (String(h) === String(peak.hour)) ? '  <-- peak' : '';
    const deltaStr = b.fhDelta > 0 ? ` (${b.fhDelta.toFixed(1)}% of 5h)` : '';

    console.log(`    ${label}  ${barStr}  ${formatTokens(b.tokens).padStart(6)}  ${b.count} msgs${deltaStr}${peakMarker}`);
  }
}

function dailyBreakdown(entries) {
  if (entries.length === 0) return;

  const dayBuckets = {};
  for (const e of entries) {
    const d = dateStr(e._date);
    if (!dayBuckets[d]) dayBuckets[d] = { tokens: 0, count: 0, sdDelta: 0, date: e._date };
    dayBuckets[d].tokens += (e.input_tokens || 0) + (e.output_tokens || 0);
    dayBuckets[d].count++;
    dayBuckets[d].sdDelta += (e.seven_day_delta_pct || 0);
  }

  const days = Object.entries(dayBuckets).sort(([a], [b]) => a.localeCompare(b));
  const maxTokens = Math.max(...days.map(([, b]) => b.tokens), 1);
  const busiestDay = days.reduce((best, [d, b]) => b.tokens > best.tokens ? { day: d, ...b } : best, { tokens: 0 });

  console.log('\n  Daily Breakdown:');
  console.log('  ────────────────────────────────────────────────────');

  for (const [d, b] of days) {
    const dn = dayName(b.date);
    const barStr = bar(b.tokens, maxTokens, 15);
    const busyMarker = d === busiestDay.day ? '  <-- busiest' : '';
    const deltaStr = b.sdDelta > 0 ? ` (${b.sdDelta.toFixed(1)}% of 7d)` : '';

    console.log(`    ${d} ${dn.padEnd(10)} ${barStr}  ${formatTokens(b.tokens).padStart(6)}  ${b.count} msgs${deltaStr}${busyMarker}`);
  }
}

// --- Tokens Per Percent Analysis ---

function tokensPerPercent(entries) {
  // For each interaction with both token data AND a delta, compute the ratio
  const samples5h = [];
  const samples7d = [];

  for (const e of entries) {
    const totalTokens = (e.input_tokens || 0) + (e.output_tokens || 0);
    if (totalTokens === 0) continue;

    if (e.five_hour_delta_pct > 0) {
      samples5h.push({
        tokensPerPct: totalTokens / e.five_hour_delta_pct,
        tokens: totalTokens,
        deltaPct: e.five_hour_delta_pct,
        hour: e._date.getHours(),
        dayOfWeek: e._date.getDay(),
        date: e._date
      });
    }
    if (e.seven_day_delta_pct > 0) {
      samples7d.push({
        tokensPerPct: totalTokens / e.seven_day_delta_pct,
        tokens: totalTokens,
        deltaPct: e.seven_day_delta_pct,
        hour: e._date.getHours(),
        dayOfWeek: e._date.getDay(),
        date: e._date
      });
    }
  }

  return { samples5h, samples7d };
}

function statsOf(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    avg: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: sorted.length
  };
}

function printTokensPerPercentReport(entries) {
  const { samples5h, samples7d } = tokensPerPercent(entries);

  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║    Tokens Per 1% of Limit            ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('  (How many tokens does it take to consume 1% of your limit?)');

  // --- 5-hour window ---
  if (samples5h.length >= 2) {
    const ratios = samples5h.map((s) => s.tokensPerPct);
    const s = statsOf(ratios);

    console.log('\n  5-Hour Limit:');
    console.log(`    Average:  ${formatTokens(s.avg)} tokens = 1%`);
    console.log(`    Median:   ${formatTokens(s.median)} tokens = 1%`);
    console.log(`    Range:    ${formatTokens(s.min)} - ${formatTokens(s.max)} tokens = 1%`);
    console.log(`    Samples:  ${s.count} interactions with measurable delta`);

    // "Budget planner" - how many interactions like your average can you afford?
    const latest5h = entries.filter((e) => e.five_hour_pct != null).pop();
    if (latest5h) {
      const remaining = 100 - latest5h.five_hour_pct;
      const avgTokensPerInteraction = samples5h.reduce((s, e) => s + e.tokens, 0) / samples5h.length;
      const pctPerInteraction = avgTokensPerInteraction / s.avg;
      const interactionsLeft = remaining / pctPerInteraction;
      console.log(`\n    Budget estimate (at current pace):`);
      console.log(`      Remaining:     ${remaining.toFixed(1)}% of 5h window`);
      console.log(`      Avg per msg:   ~${pctPerInteraction.toFixed(2)}% per interaction`);
      console.log(`      Msgs left:     ~${Math.floor(interactionsLeft)} more interactions before limit`);
    }

    // Variation by hour of day
    printVariationByHour('5-hour', samples5h);
  } else {
    console.log('\n  5-Hour Limit: Not enough data yet (need 2+ interactions with deltas)');
  }

  // --- 7-day window ---
  if (samples7d.length >= 2) {
    const ratios = samples7d.map((s) => s.tokensPerPct);
    const s = statsOf(ratios);

    console.log('\n  7-Day Limit:');
    console.log(`    Average:  ${formatTokens(s.avg)} tokens = 1%`);
    console.log(`    Median:   ${formatTokens(s.median)} tokens = 1%`);
    console.log(`    Range:    ${formatTokens(s.min)} - ${formatTokens(s.max)} tokens = 1%`);
    console.log(`    Samples:  ${s.count} interactions with measurable delta`);

    const latest7d = entries.filter((e) => e.seven_day_pct != null).pop();
    if (latest7d) {
      const remaining = 100 - latest7d.seven_day_pct;
      const avgTokensPerInteraction = samples7d.reduce((s, e) => s + e.tokens, 0) / samples7d.length;
      const pctPerInteraction = avgTokensPerInteraction / s.avg;
      const interactionsLeft = remaining / pctPerInteraction;
      console.log(`\n    Budget estimate (at current pace):`);
      console.log(`      Remaining:     ${remaining.toFixed(1)}% of 7d window`);
      console.log(`      Avg per msg:   ~${pctPerInteraction.toFixed(2)}% per interaction`);
      console.log(`      Msgs left:     ~${Math.floor(interactionsLeft)} more interactions before limit`);
    }

    // Variation by day of week
    printVariationByDayOfWeek('7-day', samples7d);
  } else {
    console.log('\n  7-Day Limit: Not enough data yet (need 2+ interactions with deltas)');
  }
}

function printVariationByHour(windowName, samples) {
  // Group by hour, compute avg tokens-per-percent for each
  const byHour = {};
  for (const s of samples) {
    if (!byHour[s.hour]) byHour[s.hour] = [];
    byHour[s.hour].push(s.tokensPerPct);
  }

  const hourStats = Object.entries(byHour)
    .map(([h, vals]) => ({ hour: Number(h), ...statsOf(vals) }))
    .filter((s) => s.count >= 1)
    .sort((a, b) => a.hour - b.hour);

  if (hourStats.length < 2) return;

  const overallAvg = samples.reduce((s, e) => s + e.tokensPerPct, 0) / samples.length;
  const hasVariation = hourStats.some((s) => Math.abs(s.avg - overallAvg) / overallAvg > 0.15);

  console.log(`\n    Tokens-per-1% by hour of day (${windowName}):`);

  if (!hasVariation) {
    console.log('    Ratio is fairly consistent across hours (no significant peak/off-peak difference).');
    console.log('    This means 1% costs roughly the same tokens regardless of when you work.');
  }

  const maxAvg = Math.max(...hourStats.map((s) => s.avg));
  for (const s of hourStats) {
    const label = hourLabel(s.hour);
    const barStr = bar(s.avg, maxAvg, 12);
    const diff = ((s.avg - overallAvg) / overallAvg * 100).toFixed(0);
    const diffStr = Number(diff) > 0 ? `+${diff}%` : `${diff}%`;
    const marker = Math.abs(Number(diff)) > 15 ? (Number(diff) > 0 ? '  (cheaper)' : '  (costlier)') : '';
    console.log(`      ${label}  ${barStr}  ${formatTokens(s.avg).padStart(6)}/1%  (${diffStr} vs avg, ${s.count} samples)${marker}`);
  }

  // Find best/worst times
  const cheapest = hourStats.reduce((best, s) => s.avg > best.avg ? s : best, hourStats[0]);
  const costliest = hourStats.reduce((best, s) => s.avg < best.avg ? s : best, hourStats[0]);

  if (cheapest.hour !== costliest.hour && hasVariation) {
    console.log(`\n    Best time to work:   ${hourLabel(cheapest.hour)} (${formatTokens(cheapest.avg)} tokens per 1% - most value)`);
    console.log(`    Most expensive:      ${hourLabel(costliest.hour)} (${formatTokens(costliest.avg)} tokens per 1% - least value)`);
  }
}

function printVariationByDayOfWeek(windowName, samples) {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const byDay = {};
  for (const s of samples) {
    if (!byDay[s.dayOfWeek]) byDay[s.dayOfWeek] = [];
    byDay[s.dayOfWeek].push(s.tokensPerPct);
  }

  const dayStats = Object.entries(byDay)
    .map(([d, vals]) => ({ day: Number(d), name: dayNames[Number(d)], ...statsOf(vals) }))
    .filter((s) => s.count >= 1)
    .sort((a, b) => a.day - b.day);

  if (dayStats.length < 2) return;

  const overallAvg = samples.reduce((s, e) => s + e.tokensPerPct, 0) / samples.length;
  const hasVariation = dayStats.some((s) => Math.abs(s.avg - overallAvg) / overallAvg > 0.15);

  console.log(`\n    Tokens-per-1% by day of week (${windowName}):`);

  if (!hasVariation) {
    console.log('    Ratio is fairly consistent across days (no significant weekday/weekend difference).');
  }

  const maxAvg = Math.max(...dayStats.map((s) => s.avg));
  for (const s of dayStats) {
    const barStr = bar(s.avg, maxAvg, 12);
    const diff = ((s.avg - overallAvg) / overallAvg * 100).toFixed(0);
    const diffStr = Number(diff) > 0 ? `+${diff}%` : `${diff}%`;
    const marker = Math.abs(Number(diff)) > 15 ? (Number(diff) > 0 ? '  (cheaper)' : '  (costlier)') : '';
    console.log(`      ${s.name.padEnd(10)}  ${barStr}  ${formatTokens(s.avg).padStart(6)}/1%  (${diffStr} vs avg, ${s.count} samples)${marker}`);
  }
}

// --- GUI Dashboard ---

function computeBudget(samples, currentPct) {
  if (!samples.length || currentPct == null) return null;
  const ratios = samples.map((s) => s.tokensPerPct);
  const s = statsOf(ratios);
  const remaining = 100 - currentPct;
  const avgTokens = samples.reduce((sum, e) => sum + e.tokens, 0) / samples.length;
  const pctPerInteraction = avgTokens / s.avg;
  return {
    remaining: Math.round(remaining * 10) / 10,
    avgTokensPerPct: Math.round(s.avg),
    medianTokensPerPct: Math.round(s.median),
    minTokensPerPct: Math.round(s.min),
    maxTokensPerPct: Math.round(s.max),
    pctPerInteraction: Math.round(pctPerInteraction * 100) / 100,
    interactionsLeft: Math.floor(remaining / pctPerInteraction),
    sampleCount: s.count
  };
}

function prepareGUIData(allEntries) {
  const weekEntries = filterWeek(allEntries);
  const todayEntries = filterToday(allEntries);
  const latest = allEntries.length > 0 ? allEntries[allEntries.length - 1] : {};

  const { samples5h, samples7d } = tokensPerPercent(weekEntries);

  // Hourly heatmap data: { "YYYY-MM-DD|HH": tokens }
  const hourlyHeatmap = {};
  for (const e of weekEntries) {
    const key = dateStr(e._date) + '|' + e._date.getHours();
    if (!hourlyHeatmap[key]) hourlyHeatmap[key] = 0;
    hourlyHeatmap[key] += (e.input_tokens || 0) + (e.output_tokens || 0);
  }

  // Daily totals
  const dailyTotals = {};
  for (const e of weekEntries) {
    const d = dateStr(e._date);
    if (!dailyTotals[d]) dailyTotals[d] = { input: 0, output: 0 };
    dailyTotals[d].input += (e.input_tokens || 0);
    dailyTotals[d].output += (e.output_tokens || 0);
  }

  // Hourly variation for tokens-per-percent
  const hourlyVariation5h = {};
  for (const s of samples5h) {
    if (!hourlyVariation5h[s.hour]) hourlyVariation5h[s.hour] = [];
    hourlyVariation5h[s.hour].push(s.tokensPerPct);
  }
  const hourlyAvg5h = {};
  for (const [h, vals] of Object.entries(hourlyVariation5h)) {
    hourlyAvg5h[h] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  // Day-of-week variation
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dowVariation7d = {};
  for (const s of samples7d) {
    const dn = dayNames[s.dayOfWeek];
    if (!dowVariation7d[dn]) dowVariation7d[dn] = [];
    dowVariation7d[dn].push(s.tokensPerPct);
  }
  const dowAvg7d = {};
  for (const [d, vals] of Object.entries(dowVariation7d)) {
    dowAvg7d[d] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  // Trend data - 5h and 7d
  const trendData5h = samples5h.map((s) => ({
    t: s.date.toISOString(),
    v: Math.round(s.tokensPerPct)
  }));
  const trendData7d = samples7d.map((s) => ({
    t: s.date.toISOString(),
    v: Math.round(s.tokensPerPct)
  }));

  return {
    generatedAt: new Date().toISOString(),
    totalEntries: allEntries.length,
    weekEntries: weekEntries.length,
    todayEntries: todayEntries.length,
    currentStatus: {
      fiveHourPct: latest.five_hour_pct != null ? latest.five_hour_pct : null,
      sevenDayPct: latest.seven_day_pct != null ? latest.seven_day_pct : null,
      fiveHourReset: latest.five_hour_resets_at || null,
      sevenDayReset: latest.seven_day_resets_at || null
    },
    budget5h: computeBudget(samples5h, latest.five_hour_pct),
    budget7d: computeBudget(samples7d, latest.seven_day_pct),
    hourlyHeatmap,
    dailyTotals,
    hourlyAvg5h,
    dowAvg7d,
    trendData5h,
    trendData7d
  };
}

function buildDashboardHTML(data) {
  const dataJSON = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Usage Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0f0f1a;
    color: #e0e0e0;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    padding: 20px;
    min-height: 100vh;
  }
  h1 { color: #a78bfa; font-size: 1.6rem; margin-bottom: 4px; }
  .subtitle { color: #888; font-size: 0.85rem; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 1100px; margin: 0 auto; }
  .card {
    background: #1a1a2e;
    border: 1px solid #2a2a40;
    border-radius: 10px;
    padding: 20px;
  }
  .card.full { grid-column: 1 / -1; }
  .card h2 { color: #c4b5fd; font-size: 1.05rem; margin-bottom: 12px; font-weight: 600; }
  .card h3 { color: #a78bfa; font-size: 0.9rem; margin: 12px 0 6px; }
  .gauge-wrap { display: flex; align-items: center; gap: 20px; }
  .gauge-info { flex: 1; }
  .gauge-info .pct { font-size: 2rem; font-weight: 700; }
  .gauge-info .label { color: #888; font-size: 0.85rem; }
  .gauge-info .detail { color: #aaa; font-size: 0.8rem; margin-top: 4px; }
  .stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #222238; }
  .stat-row:last-child { border: none; }
  .stat-label { color: #999; }
  .stat-value { color: #e0e0e0; font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat-value.green { color: #4ade80; }
  .stat-value.yellow { color: #facc15; }
  .stat-value.red { color: #f87171; }
  canvas { width: 100%; height: auto; border-radius: 6px; }
  .no-data { color: #666; font-style: italic; padding: 30px; text-align: center; }
  .footer { text-align: center; color: #555; font-size: 0.8rem; margin-top: 20px; max-width: 1100px; margin-left: auto; margin-right: auto; }
  .budget-big { font-size: 2.2rem; font-weight: 700; color: #4ade80; text-align: center; margin: 10px 0; }
  .budget-sub { text-align: center; color: #999; font-size: 0.85rem; }
  .var-bar-wrap { display: flex; align-items: center; gap: 8px; margin: 3px 0; font-size: 0.82rem; }
  .var-label { width: 40px; text-align: right; color: #999; }
  .var-bar { height: 18px; border-radius: 3px; min-width: 2px; }
  .var-val { color: #ccc; min-width: 70px; }
  .var-tag { font-size: 0.7rem; padding: 1px 5px; border-radius: 3px; }
  .var-tag.cheaper { background: #064e3b; color: #6ee7b7; }
  .var-tag.costlier { background: #7f1d1d; color: #fca5a5; }
</style>
</head>
<body>
<div class="grid">
  <div class="card full" style="text-align:center; padding: 14px;">
    <h1>Claude Usage Dashboard</h1>
    <div class="subtitle">Generated: ${new Date(data.generatedAt).toLocaleString()} &bull; ${data.totalEntries} total entries &bull; ${data.weekEntries} this week</div>
  </div>

  <!-- Gauge: 5-hour -->
  <div class="card">
    <h2>5-Hour Limit</h2>
    <div class="gauge-wrap">
      <canvas id="gauge5h" width="140" height="140"></canvas>
      <div class="gauge-info">
        <div class="pct" id="pct5h">--</div>
        <div class="label">used</div>
        <div class="detail" id="reset5h"></div>
      </div>
    </div>
  </div>

  <!-- Gauge: 7-day -->
  <div class="card">
    <h2>7-Day Limit</h2>
    <div class="gauge-wrap">
      <canvas id="gauge7d" width="140" height="140"></canvas>
      <div class="gauge-info">
        <div class="pct" id="pct7d">--</div>
        <div class="label">used</div>
        <div class="detail" id="reset7d"></div>
      </div>
    </div>
  </div>

  <!-- Tokens per 1% -->
  <div class="card">
    <h2>Tokens Per 1% of Limit</h2>
    <div id="tpp-content"></div>
  </div>

  <!-- Budget planner -->
  <div class="card">
    <h2>Budget Planner</h2>
    <div id="budget-content"></div>
  </div>

  <!-- Variation by hour -->
  <div class="card">
    <h2>Tokens/1% by Hour (5h window)</h2>
    <div id="var-hour"></div>
  </div>

  <!-- Variation by day -->
  <div class="card">
    <h2>Tokens/1% by Day (7d window)</h2>
    <div id="var-dow"></div>
  </div>

  <!-- Daily bar chart -->
  <div class="card full">
    <h2>Daily Token Usage (Last 7 Days)</h2>
    <canvas id="dailyChart" height="220"></canvas>
  </div>

  <!-- Hourly heatmap -->
  <div class="card full">
    <h2>Hourly Heatmap (Last 7 Days)</h2>
    <canvas id="heatmap" height="320"></canvas>
  </div>

  <!-- Trend lines -->
  <div class="card">
    <h2>Tokens/1% Over Time (5h)</h2>
    <canvas id="trendChart5h" height="200"></canvas>
  </div>
  <div class="card">
    <h2>Tokens/1% Over Time (7d)</h2>
    <canvas id="trendChart7d" height="200"></canvas>
  </div>
</div>

<div class="footer">
  Re-run <code>usage-dashboard --gui</code> to refresh &bull;
  CLI: <code>usage-dashboard --today</code> | <code>--week</code> | <code>--efficiency</code> | <code>--json</code>
</div>

<script>
const DATA = ${dataJSON};

function fmtTokens(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function pctColor(pct) {
  if (pct >= 90) return '#ef4444';
  if (pct >= 80) return '#f87171';
  if (pct >= 60) return '#facc15';
  return '#4ade80';
}

function pctClass(pct) {
  if (pct >= 80) return 'red';
  if (pct >= 60) return 'yellow';
  return 'green';
}

function fmtDuration(epoch) {
  if (!epoch) return '';
  let diff = epoch - Math.floor(Date.now()/1000);
  if (diff <= 0) return 'now';
  const d = Math.floor(diff/86400); diff %= 86400;
  const h = Math.floor(diff/3600); diff %= 3600;
  const m = Math.floor(diff/60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function hiDpiCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

// --- Gauges ---
function drawGauge(id, pct, resetId, resetEpoch) {
  const canvas = document.getElementById(id);
  const w = 140, h = 140;
  const ctx = hiDpiCanvas(canvas, w, h);
  const cx = w/2, cy = h/2, r = 54, lw = 12;
  const startAngle = 0.75 * Math.PI;
  const endAngle = 2.25 * Math.PI;

  if (pct == null) {
    ctx.fillStyle = '#444';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', cx, cy);
    return;
  }

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = '#2a2a40';
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Foreground arc
  const fillAngle = startAngle + (endAngle - startAngle) * (pct / 100);
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, fillAngle);
  ctx.strokeStyle = pctColor(pct);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Center text
  ctx.fillStyle = pctColor(pct);
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pct.toFixed(1) + '%', cx, cy);

  // Set info
  const pctEl = document.getElementById(id === 'gauge5h' ? 'pct5h' : 'pct7d');
  if (pctEl) { pctEl.textContent = pct.toFixed(1) + '%'; pctEl.style.color = pctColor(pct); }
  const resetEl = document.getElementById(resetId);
  if (resetEl && resetEpoch) resetEl.textContent = 'Resets in ' + fmtDuration(resetEpoch);
}

// --- Tokens per percent stats ---
function renderTPP() {
  const el = document.getElementById('tpp-content');
  const b5 = DATA.budget5h;
  const b7 = DATA.budget7d;
  if (!b5 && !b7) { el.innerHTML = '<div class="no-data">Not enough data yet</div>'; return; }
  let html = '';
  if (b5) {
    html += '<h3>5-Hour Window</h3>';
    html += '<div class="stat-row"><span class="stat-label">Average</span><span class="stat-value">' + fmtTokens(b5.avgTokensPerPct) + ' tokens = 1%</span></div>';
    html += '<div class="stat-row"><span class="stat-label">Median</span><span class="stat-value">' + fmtTokens(b5.medianTokensPerPct) + ' tokens = 1%</span></div>';
    html += '<div class="stat-row"><span class="stat-label">Range</span><span class="stat-value">' + fmtTokens(b5.minTokensPerPct) + ' - ' + fmtTokens(b5.maxTokensPerPct) + '</span></div>';
    html += '<div class="stat-row"><span class="stat-label">Samples</span><span class="stat-value">' + b5.sampleCount + '</span></div>';
  }
  if (b7) {
    html += '<h3>7-Day Window</h3>';
    html += '<div class="stat-row"><span class="stat-label">Average</span><span class="stat-value">' + fmtTokens(b7.avgTokensPerPct) + ' tokens = 1%</span></div>';
    html += '<div class="stat-row"><span class="stat-label">Median</span><span class="stat-value">' + fmtTokens(b7.medianTokensPerPct) + ' tokens = 1%</span></div>';
    html += '<div class="stat-row"><span class="stat-label">Range</span><span class="stat-value">' + fmtTokens(b7.minTokensPerPct) + ' - ' + fmtTokens(b7.maxTokensPerPct) + '</span></div>';
    html += '<div class="stat-row"><span class="stat-label">Samples</span><span class="stat-value">' + b7.sampleCount + '</span></div>';
  }
  el.innerHTML = html;
}

// --- Budget ---
function renderBudget() {
  const el = document.getElementById('budget-content');
  const b5 = DATA.budget5h;
  const b7 = DATA.budget7d;
  if (!b5 && !b7) { el.innerHTML = '<div class="no-data">Not enough data yet</div>'; return; }
  let html = '';
  if (b5) {
    html += '<h3>5-Hour Window</h3>';
    html += '<div class="budget-big">&asymp; ' + b5.interactionsLeft + ' msgs left</div>';
    html += '<div class="budget-sub">' + b5.remaining + '% remaining &bull; ~' + b5.pctPerInteraction + '% per interaction</div>';
  }
  if (b7) {
    html += '<h3 style="margin-top:16px">7-Day Window</h3>';
    html += '<div class="budget-big">&asymp; ' + b7.interactionsLeft + ' msgs left</div>';
    html += '<div class="budget-sub">' + b7.remaining + '% remaining &bull; ~' + b7.pctPerInteraction + '% per interaction</div>';
  }
  el.innerHTML = html;
}

// --- Variation bars ---
function renderVariation(containerId, dataMap, barColor) {
  const el = document.getElementById(containerId);
  const entries = Object.entries(dataMap);
  if (entries.length === 0) { el.innerHTML = '<div class="no-data">Not enough data</div>'; return; }
  const vals = entries.map(([,v]) => v);
  const maxVal = Math.max(...vals);
  const avgVal = vals.reduce((a,b)=>a+b,0) / vals.length;
  let html = '';
  for (const [label, val] of entries) {
    const pct = (val / maxVal * 100).toFixed(0);
    const diff = ((val - avgVal) / avgVal * 100).toFixed(0);
    const diffStr = Number(diff) > 0 ? '+' + diff + '%' : diff + '%';
    let tag = '';
    if (Math.abs(Number(diff)) > 15) {
      tag = Number(diff) > 0
        ? ' <span class="var-tag cheaper">cheaper</span>'
        : ' <span class="var-tag costlier">costlier</span>';
    }
    html += '<div class="var-bar-wrap">';
    html += '<span class="var-label">' + label + '</span>';
    html += '<div class="var-bar" style="width:' + pct + '%;background:' + barColor + '"></div>';
    html += '<span class="var-val">' + fmtTokens(val) + '/1% (' + diffStr + ')' + tag + '</span>';
    html += '</div>';
  }
  el.innerHTML = html;
}

// --- Daily bar chart ---
function drawDailyChart() {
  const canvas = document.getElementById('dailyChart');
  const entries = Object.entries(DATA.dailyTotals).sort(([a],[b]) => a.localeCompare(b));
  if (entries.length === 0) { canvas.parentElement.querySelector('h2').after(Object.assign(document.createElement('div'),{className:'no-data',textContent:'No data'})); canvas.style.display='none'; return; }

  const w = canvas.parentElement.clientWidth - 40;
  const h = 200;
  const ctx = hiDpiCanvas(canvas, w, h);
  const pad = { top: 10, right: 10, bottom: 40, left: 60 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const maxTokens = Math.max(...entries.map(([,d]) => d.input + d.output));
  const barW = Math.min(60, (plotW / entries.length) * 0.7);
  const gap = (plotW - barW * entries.length) / (entries.length + 1);

  // Grid lines
  ctx.strokeStyle = '#222238';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + plotH * (1 - i/4);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(fmtTokens(maxTokens * i/4), pad.left - 8, y + 4);
  }

  // Bars
  entries.forEach(([date, d], i) => {
    const x = pad.left + gap + i * (barW + gap);
    const totalH = ((d.input + d.output) / maxTokens) * plotH;
    const inH = (d.input / (d.input + d.output)) * totalH;
    const outH = totalH - inH;

    // Output (top, lighter)
    ctx.fillStyle = '#7c3aed';
    ctx.fillRect(x, pad.top + plotH - totalH, barW, outH);
    // Input (bottom, brighter)
    ctx.fillStyle = '#a78bfa';
    ctx.fillRect(x, pad.top + plotH - inH, barW, inH);

    // Date label
    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    const shortDate = date.slice(5); // MM-DD
    ctx.save();
    ctx.translate(x + barW/2, h - pad.bottom + 14);
    ctx.fillText(shortDate, 0, 0);
    const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {weekday:'short'});
    ctx.fillText(dayName, 0, 14);
    ctx.restore();
  });

  // Legend
  ctx.fillStyle = '#a78bfa'; ctx.fillRect(w - 160, 8, 12, 12);
  ctx.fillStyle = '#999'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Input', w - 144, 18);
  ctx.fillStyle = '#7c3aed'; ctx.fillRect(w - 90, 8, 12, 12);
  ctx.fillStyle = '#999'; ctx.fillText('Output', w - 74, 18);
}

// --- Heatmap ---
function drawHeatmap() {
  const canvas = document.getElementById('heatmap');
  const hm = DATA.hourlyHeatmap;
  const keys = Object.keys(hm);
  if (keys.length === 0) { canvas.parentElement.querySelector('h2').after(Object.assign(document.createElement('div'),{className:'no-data',textContent:'No data'})); canvas.style.display='none'; return; }

  // Get date range and hour range
  const dates = [...new Set(keys.map(k => k.split('|')[0]))].sort();
  const w = canvas.parentElement.clientWidth - 40;
  const padL = 50, padT = 10, padB = 40, padR = 20;
  const cols = dates.length;
  const rows = 24;
  const cellW = Math.min(60, (w - padL - padR) / cols);
  const cellH = Math.min(16, 280 / rows);
  const totalW = padL + cols * cellW + padR;
  const totalH = padT + rows * cellH + padB;
  const ctx = hiDpiCanvas(canvas, Math.max(w, totalW), totalH);

  const maxVal = Math.max(...Object.values(hm));

  // Draw cells
  for (let row = 0; row < rows; row++) {
    for (let ci = 0; ci < cols; ci++) {
      const key = dates[ci] + '|' + row;
      const val = hm[key] || 0;
      const intensity = maxVal > 0 ? val / maxVal : 0;
      const x = padL + ci * cellW;
      const y = padT + row * cellH;

      if (val === 0) {
        ctx.fillStyle = '#1a1a2e';
      } else {
        // Purple intensity scale
        const r = Math.round(66 + intensity * 101);
        const g = Math.round(20 + intensity * 38);
        const b = Math.round(90 + intensity * 147);
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      }
      ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
    }
  }

  // Hour labels (left)
  ctx.fillStyle = '#888';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let row = 0; row < rows; row += 2) {
    const h = row;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    ctx.fillText(hr + ampm, padL - 6, padT + row * cellH + cellH/2 + 3);
  }

  // Date labels (bottom)
  ctx.textAlign = 'center';
  for (let ci = 0; ci < cols; ci++) {
    const x = padL + ci * cellW + cellW/2;
    const y = padT + rows * cellH + 14;
    ctx.fillText(dates[ci].slice(5), x, y);
    const dayName = new Date(dates[ci] + 'T12:00:00').toLocaleDateString('en-US', {weekday:'short'});
    ctx.fillText(dayName, x, y + 13);
  }
}

// --- Trend line ---
function drawTrend(canvasId, points, lineColor) {
  const canvas = document.getElementById(canvasId);
  if (points.length < 2) { canvas.parentElement.querySelector('h2').after(Object.assign(document.createElement('div'),{className:'no-data',textContent:'Need 2+ data points'})); canvas.style.display='none'; return; }

  const w = canvas.parentElement.clientWidth - 40;
  const h = 180;
  const ctx = hiDpiCanvas(canvas, w, h);
  const pad = { top: 10, right: 10, bottom: 30, left: 60 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const vals = points.map(p => p.v);
  const minV = Math.min(...vals) * 0.8;
  const maxV = Math.max(...vals) * 1.1;
  const avgV = vals.reduce((a,b) => a+b, 0) / vals.length;

  const times = points.map(p => new Date(p.t).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const rangeT = maxT - minT || 1;

  function xFor(t) { return pad.left + ((t - minT) / rangeT) * plotW; }
  function yFor(v) { return pad.top + plotH - ((v - minV) / (maxV - minV)) * plotH; }

  // Grid
  ctx.strokeStyle = '#222238';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = minV + (maxV - minV) * i/4;
    const y = yFor(v);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#666'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(fmtTokens(v), pad.left - 8, y + 4);
  }

  // Average line (dashed)
  ctx.setLineDash([5,5]);
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, yFor(avgV));
  ctx.lineTo(w - pad.right, yFor(avgV));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#facc15';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('avg: ' + fmtTokens(avgV), w - pad.right - 80, yFor(avgV) - 6);

  // Line
  ctx.beginPath();
  ctx.strokeStyle = lineColor || '#a78bfa';
  ctx.lineWidth = 2;
  points.forEach((p, i) => {
    const x = xFor(new Date(p.t).getTime());
    const y = yFor(p.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots
  points.forEach(p => {
    const x = xFor(new Date(p.t).getTime());
    const y = yFor(p.v);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#c4b5fd';
    ctx.fill();
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // Time labels
  ctx.fillStyle = '#888';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const labelCount = Math.min(points.length, 8);
  const step = Math.max(1, Math.floor(points.length / labelCount));
  for (let i = 0; i < points.length; i += step) {
    const d = new Date(points[i].t);
    const x = xFor(d.getTime());
    ctx.fillText(d.toLocaleDateString('en-US', {month:'short',day:'numeric'}), x, h - pad.bottom + 14);
  }
}

// --- Init ---
window.addEventListener('DOMContentLoaded', () => {
  drawGauge('gauge5h', DATA.currentStatus.fiveHourPct, 'reset5h', DATA.currentStatus.fiveHourReset);
  drawGauge('gauge7d', DATA.currentStatus.sevenDayPct, 'reset7d', DATA.currentStatus.sevenDayReset);
  renderTPP();
  renderBudget();
  renderVariation('var-hour', DATA.hourlyAvg5h, '#a78bfa');
  renderVariation('var-dow', DATA.dowAvg7d, '#7c3aed');
  drawDailyChart();
  drawHeatmap();
  drawTrend('trendChart5h', DATA.trendData5h, '#a78bfa');
  drawTrend('trendChart7d', DATA.trendData7d, '#7c3aed');
});
</script>
</body>
</html>`;
}

function generateGUI(allEntries) {
  const data = prepareGUIData(allEntries);
  const html = buildDashboardHTML(data);

  const tmpPath = path.join(os.tmpdir(), 'claude-usage-dashboard.html');
  fs.writeFileSync(tmpPath, html, 'utf8');

  const cmd = process.platform === 'win32'
    ? `start "" "${tmpPath}"`
    : process.platform === 'darwin'
      ? `open "${tmpPath}"`
      : `xdg-open "${tmpPath}"`;

  exec(cmd, (err) => {
    if (err) console.error('Could not open browser:', err.message);
  });

  console.log('Dashboard written to: ' + tmpPath);
  console.log('Opening in default browser...');
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--week';
  const jsonOutput = args.includes('--json');

  const allEntries = loadEntries();

  if (args.includes('--gui')) {
    generateGUI(allEntries);
    return;
  }

  if (jsonOutput) {
    let entries;
    if (mode === '--today') entries = filterToday(allEntries);
    else entries = filterWeek(allEntries);

    // Strip internal _date field
    const clean = entries.map(({ _date, ...rest }) => rest);
    console.log(JSON.stringify(clean, null, 2));
    return;
  }

  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║       Claude Usage Report            ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log(`  Generated: ${new Date().toLocaleString()}`);
  console.log(`  Log entries: ${allEntries.length} total`);

  if (mode === '--today') {
    const todayEntries = filterToday(allEntries);
    const todayLabel = `Today (${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })})`;
    summarize(todayEntries, todayLabel);
    hourlyBreakdown(todayEntries);
    printTokensPerPercentReport(todayEntries);
  } else if (mode === '--hourly') {
    const weekEntries = filterWeek(allEntries);
    console.log('\n  Hourly patterns (last 7 days):');
    hourlyBreakdown(weekEntries);
  } else if (mode === '--efficiency') {
    // Dedicated tokens-per-percent analysis with all available data
    printTokensPerPercentReport(allEntries);
  } else {
    // --week (default)
    const todayEntries = filterToday(allEntries);
    const todayLabel = `Today (${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })})`;
    summarize(todayEntries, todayLabel);
    hourlyBreakdown(todayEntries);

    const weekEntries = filterWeek(allEntries);
    summarize(weekEntries, 'This Week');
    dailyBreakdown(weekEntries);

    // Always show tokens-per-percent (the key planning metric)
    printTokensPerPercentReport(weekEntries);
  }

  console.log('\n  ────────────────────────────────────────────────────');
  console.log('  Tip: Use --today, --week, --hourly, --efficiency, --gui, or --json');
  console.log('');
}

main();
