const cfg = require('./config');
const { buildSeed } = require('./data/seed');
const recovery = require('./engine/recovery');
const { evaluateEligibility } = require('./engine/eligibility');
const { iso } = require('./lib/format');

// In-memory data store with one private sandbox per visitor, so people using
// a shared link don't see or reset each other's demo. `version` bumps on every
// change so clients can poll cheaply.
const MAX_SESSIONS = 300;
const sessions = new Map(); // session id -> { db, version }, oldest first

function session(id) {
  let s = sessions.get(id);
  if (s) {
    sessions.delete(id); // re-insert to mark as most recently used
  } else {
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    s = { db: buildSeed(Date.now()), version: 1 };
  }
  sessions.set(id, s);
  return s;
}

function reset(id) {
  const version = (sessions.get(id)?.version || 0) + 1;
  sessions.delete(id);
  session(id).version = version;
}

function mutate(id, fn) {
  const s = session(id);
  const now = Date.now();
  recovery.sweepExpired(s.db, now);
  const result = fn(s.db, now);
  s.version++;
  return result;
}

function snapshot(id) {
  const s = session(id);
  const { db } = s;
  const now = Date.now();
  if (recovery.sweepExpired(db, now)) s.version++;

  const { PORT, ...config } = cfg;
  return {
    version: s.version,
    server_time: iso(now),
    config,
    hubs: db.hubs.map((h) => ({
      ...h,
      held_parcels_count: db.orders.filter((o) => o.hub_id === h.hub_id && ['held', 'rescheduled'].includes(o.status)).length,
    })),
    riders: db.riders,
    customers: db.customers.map((c) => ({ ...c, eligibility: evaluateEligibility(c, now) })),
    orders: db.orders,
    attempts: db.attempts,
    cases: db.cases,
  };
}

module.exports = { reset, mutate, snapshot };
