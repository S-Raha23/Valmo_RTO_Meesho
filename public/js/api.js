// Each browser gets its own demo sandbox on the server. It is shared by all tabs
// of this browser (so Driver, Customer and Hub stay in sync) but not with other visitors.
const SESSION_ID = (() => {
  const fresh = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    let id = localStorage.getItem('rto-session');
    if (!id) localStorage.setItem('rto-session', (id = fresh()));
    return id;
  } catch {
    return fresh();
  }
})();

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Session-Id': SESSION_ID, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  state: () => request('GET', '/api/state'),
  // Only the reason is sent: GPS and call log are fetched server-side from rider telemetry.
  markFailed: (orderId, reason) => request('POST', '/api/attempts', { order_id: orderId, reason }),
  caseAction: (caseId, type, extra = {}) => request('POST', `/api/cases/${caseId}/actions`, { type, ...extra }),
  addRefusal: (customerId) => request('POST', `/api/customers/${customerId}/refusals`),
  clearCustomer: (customerId) => request('POST', `/api/customers/${customerId}/clear`),
  reset: () => request('POST', '/api/reset'),
};
