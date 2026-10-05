const store = require('./store');
const recovery = require('./engine/recovery');
const customers = require('./engine/customers');

const ROUTES = [
  ['GET', /^\/api\/state$/, ({ sid }) => store.snapshot(sid)],
  ['POST', /^\/api\/attempts$/, ({ sid, body }) =>
    store.mutate(sid, (db, now) => recovery.submitAttempt(db, body, now))],
  ['POST', /^\/api\/cases\/([\w-]+)\/actions$/, ({ sid, body, params }) =>
    store.mutate(sid, (db, now) => recovery.applyAction(db, params[0], body.type, body, now))],
  ['POST', /^\/api\/customers\/([\w-]+)\/refusals$/, ({ sid, params }) =>
    store.mutate(sid, (db, now) => customers.addRefusal(db, params[0], now))],
  ['POST', /^\/api\/customers\/([\w-]+)\/clear$/, ({ sid, params }) =>
    store.mutate(sid, (db) => customers.clearHistory(db, params[0]))],
  ['POST', /^\/api\/reset$/, ({ sid }) => {
    store.reset(sid);
    return { ok: true };
  }],
];

// Each browser sends its own sandbox id; anything malformed shares a default sandbox.
const sessionId = (req) => {
  const id = req.headers['x-session-id'];
  return typeof id === 'string' && /^[\w-]{8,64}$/.test(id) ? id : 'default';
};

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) reject(Object.assign(new Error('Body too large'), { status: 413 }));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  try {
    const route = ROUTES.find(([method, re]) => method === req.method && re.test(url.pathname));
    if (!route) return send(res, 404, { error: 'Not found' });
    const params = url.pathname.match(route[1]).slice(1);
    const body = req.method === 'POST' ? await readJson(req) : {};
    send(res, 200, route[2]({ sid: sessionId(req), body, params }));
  } catch (err) {
    if (!err.status) console.error(err);
    send(res, err.status || 500, { error: err.status ? err.message : 'Internal server error' });
  }
}

module.exports = { handleApi };
