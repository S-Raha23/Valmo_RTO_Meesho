const fs = require('fs');
const path = require('path');
const recovery = require('../engine/recovery');
const { iso } = require('../lib/format');

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

// Builds a fresh in-memory database from seed.json, then replays the scripted
// history through the real engine so every seeded case is in a genuine state.
function buildSeed(now) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));

  const db = {
    counters: {},
    hubs: raw.hubs,
    riders: raw.riders,
    customers: raw.customers.map(({ refusals_days_ago = [], offer_used_days_ago = null, ...c }) => ({
      ...c,
      refusal_dates: refusals_days_ago.map((d) => iso(now - d * DAY)),
      last_offer_used_date: offer_used_days_ago == null ? null : iso(now - offer_used_days_ago * DAY),
      cod_status: 'active',
      cod_paused_at: null,
    })),
    orders: raw.orders.map((o) => ({ ...o, status: 'in_transit', reattempt_required: false })),
    attempts: [],
    cases: [],
  };

  const steps = raw.history
    .flatMap((h) => h.steps.map((s) => ({ ...s, order_id: h.order_id })))
    .sort((a, b) => b.hours_ago - a.hours_ago);

  for (const step of steps) {
    const at = now - step.hours_ago * HOUR;
    if (step.action === 'attempt') {
      recovery.submitAttempt(db, { order_id: step.order_id, reason: step.reason }, at);
    } else {
      const rc = db.cases.filter((c) => c.order_id === step.order_id).at(-1);
      const payload = step.action === 'choose_slot' ? { slot_id: rc.slot_options[step.slot].id } : {};
      recovery.applyAction(db, rc.case_id, step.action, payload, at);
    }
  }

  recovery.sweepExpired(db, now);
  return db;
}

module.exports = { buildSeed };
