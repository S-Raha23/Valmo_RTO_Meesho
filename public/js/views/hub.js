import { store, subscribe, refresh, get } from '../store.js';
import { api } from '../api.js';
import { esc, rs, fmtDist, fmtSlot, chip, stageChip, typeChip, deadline, toast, EXPIRABLE, REASON_LABELS } from '../ui.js';
import { createCasePanel } from '../components/casePanel.js';

// Hub Manager perspective: held-parcels queue, customer history, and case detail.
// Routes: #/hub · #/hub/customers · #/hub/case/<id>
export function mount(el, sub, caseId) {
  if (sub === 'case') return caseDetail(el, caseId);

  el.innerHTML = `
    <div class="page-head">
      <h1>Hub Manager</h1>
      <p class="muted">Every failed parcel is held here while the system tries to save it. Nothing is returned without a reason on record.</p>
    </div>
    <div class="kpis" data-kpis></div>
    <div class="subtabs">
      <a href="#/hub" class="${sub !== 'customers' ? 'on' : ''}">Held parcels</a>
      <a href="#/hub/customers" class="${sub === 'customers' ? 'on' : ''}">Customer history</a>
    </div>
    <div class="table-wrap"><table class="table" data-table></table></div>`;

  const table = el.querySelector('[data-table]');
  const showCustomers = sub === 'customers';

  table.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (b) {
      try {
        await (b.dataset.act === 'refusal' ? api.addRefusal(b.dataset.id) : api.clearCustomer(b.dataset.id));
        await refresh(true);
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    const row = e.target.closest('tr[data-case]');
    if (row) location.hash = `#/hub/case/${row.dataset.case}`;
  });

  function render() {
    renderKpis(el.querySelector('[data-kpis]'));
    table.innerHTML = showCustomers ? customersTable() : parcelsTable();
  }
  render();
  return subscribe(render);
}

function renderKpis(box) {
  const { cases, attempts } = store.state;
  const count = (...stages) => cases.filter((c) => stages.includes(c.stage)).length;
  const delivered = count('delivered');
  const returned = count('returned');
  const kpis = [
    ['On hold', count('awaiting_confirmation', 'awaiting_slot', 'offer_sent', 'paid_awaiting_slot', 'escalated'), ''],
    ['Rescheduled', count('rescheduled'), 'info'],
    ['Delivered again', delivered, 'ok'],
    ['Returned', returned, 'bad'],
    ['Fake attempts caught', attempts.filter((a) => a.verification_status === 'flagged').length, 'bad'],
  ];
  box.innerHTML = kpis.map(([label, value, tone]) => `<div class="kpi ${tone}"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div>`).join('');
}

function detail(rc) {
  switch (rc.stage) {
    case 'returned': return rc.return_reason_label;
    case 'offer_sent': return `Offer sent: pay ${rs(rc.offer.pay_amount)} (${rs(rc.offer.discount)} off)`;
    case 'paid_awaiting_slot': return `Paid ${rs(rc.payment.amount)} by UPI`;
    case 'rescheduled': return `Re-delivery ${fmtSlot(rc.chosen_slot)}`;
    case 'escalated': return "Customer disputes rider's report";
    case 'delivered': return 'Delivered on re-attempt';
    case 'awaiting_slot': return 'Customer confirmed, choosing a slot';
    default: return 'Waiting for customer reply';
  }
}

// 6 columns: Order · Customer · Type · Status · Detail · Hold time left
function parcelsTable() {
  const { cases, attempts } = store.state;
  const rows = [
    ...cases.map((rc) => ({ rc, at: rc.events.at(-1).at })),
    ...attempts.filter((a) => a.verification_status === 'flagged').map((a) => ({ a, at: a.timestamp })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  return `
    <thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Status</th><th>Detail</th><th>Hold time left</th></tr></thead>
    <tbody>
      ${rows.map(({ rc, a }) => rc ? `
        <tr class="clickable" data-case="${rc.case_id}">
          <td><b>${rc.order_id}</b></td>
          <td>${esc(get.customer(rc.customer_id).name)}</td>
          <td>${typeChip(rc.failure_type)}</td>
          <td>${stageChip(rc.stage)}</td>
          <td class="small">${esc(detail(rc))}</td>
          <td>${EXPIRABLE.includes(rc.stage) ? deadline(rc.hold_expires_at) : '<span class="muted">–</span>'}</td>
        </tr>` : `
        <tr>
          <td><b>${a.order_id}</b></td>
          <td>${esc(get.customer(get.order(a.order_id).customer_id).name)}</td>
          <td>${typeChip('unverified')}</td>
          <td>${stageChip('flagged')}</td>
          <td class="small">Claimed "${REASON_LABELS[a.reason_selected]}" but was ${fmtDist(a.gps_distance_to_pin_m)} away, ${a.call_duration_sec ? `${a.call_duration_sec} s call` : 'no call'}</td>
          <td><span class="muted">–</span></td>
        </tr>`).join('')}
    </tbody>`;
}

// 5 columns: Customer · Refusals (90 d / 12 mo) · COD · Offer eligibility · Demo edit
function customersTable() {
  return `
    <thead><tr><th>Customer</th><th>Refusals 90 d / 12 mo</th><th>COD</th><th>Second-chance offer</th><th></th></tr></thead>
    <tbody>
      ${store.state.customers.map((x) => {
        const e = x.eligibility;
        return `
          <tr>
            <td><b>${esc(x.name)}</b><div class="muted tiny-text">${esc(x.phone)}</div></td>
            <td>${e.refusals_90d} / <b>${e.refusals_12mo}</b></td>
            <td>${x.cod_status === 'paused' ? chip('Paused', 'bad') : chip('Active', 'ok')}</td>
            <td>${e.eligible ? chip('Eligible', 'ok') : chip('Not eligible', 'bad')}${e.reasons.map((r) => `<div class="muted tiny-text">${esc(r)}</div>`).join('')}</td>
            <td class="nowrap"><button class="btn tiny" data-act="refusal" data-id="${x.customer_id}">+ Refusal</button> <button class="btn tiny ghost" data-act="clear" data-id="${x.customer_id}">Clear</button></td>
          </tr>`;
      }).join('')}
    </tbody>`;
}

function caseDetail(el, caseId) {
  el.innerHTML = `<a class="link" href="#/hub">← Held parcels</a><div class="narrow" data-panel></div>`;
  const panel = createCasePanel(el.querySelector('[data-panel]'), () => get.case(caseId));
  panel.update();
  return subscribe(panel.update);
}
