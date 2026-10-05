const { FlowError } = require('../lib/errors');
const { iso } = require('../lib/format');

// Ops-panel edits so a presenter can change a customer's history live during the demo.

function findCustomer(db, id) {
  const customer = db.customers.find((c) => c.customer_id === id);
  if (!customer) throw new FlowError(`Unknown customer ${id}`, 404);
  return customer;
}

function addRefusal(db, id, now) {
  const customer = findCustomer(db, id);
  customer.refusal_dates.push(iso(now));
  return customer;
}

function clearHistory(db, id) {
  const customer = findCustomer(db, id);
  customer.refusal_dates = [];
  customer.last_offer_used_date = null;
  customer.cod_status = 'active';
  customer.cod_paused_at = null;
  return customer;
}

module.exports = { addRefusal, clearHistory };
