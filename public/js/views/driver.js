import { store, subscribe, refresh, setNext, get, latestCaseForOrder, firstName } from '../store.js';
import { api } from '../api.js';
import { esc, rs, fmtDist, fmtSlot, toast, REASON_LABELS } from '../ui.js';

const RIDER_ID = 'R-01';
const STEP_MS = 1000; // pace of the "fetching GPS / reading call log" animation

// Presenter notes: which order tells which story.
const STORIES = [
  ['ORD-1002', 'Arjun', 'Customer not available', 'Customer is out and picks a new delivery slot.'],
  ['ORD-1001', 'Priya', 'Customer refused', 'First refusal, so the customer gets a second-chance offer.'],
  ['ORD-1003', 'Rahul', 'Customer refused', 'Repeat refuser: no offer, COD paused, return.'],
];

// Fake attempts: each one games a different check, and each one gets flagged.
const FAKES = [
  ['ORD-1004', 'Kavya', 'Customer not available', 'Never went to the door, never called. Tap it again after the flag: the rider goes back and it passes.'],
  ['ORD-1007', 'Sneha', 'Customer not available', 'At the door but never called the customer.'],
  ['ORD-1008', 'Manoj', 'Customer refused', 'Called from 1.8 km away and claimed a refusal.'],
  ['ORD-1009', 'Ritu', 'Customer not available', 'Rang for 5 seconds and hung up.'],
];

const storyList = (list) => `<ol class="stories">${list.map(([id, name, reason, text]) =>
  `<li><b>${id}</b> · ${name}<div class="small">Pick <i>${reason}</i>. ${text}</div></li>`).join('')}</ol>`;

// Driver perspective: the Valmo Partner app on the rider's phone.
export function mount(el) {
  const s = { screen: 'list', orderId: null, reason: null, phase: 0, timer: null, result: null, busy: false };

  el.innerHTML = `
    <div class="persp">
      <div data-phone></div>
      <aside class="card notes">
        <h3>Driver's view</h3>
        <p class="muted">The rider only says <b>why</b> a delivery failed. Location and call log are read from the phone automatically, so a failure can't be faked from the road.</p>
        <div class="section-title">Genuine failures</div>
        ${storyList(STORIES)}
        <div class="section-title">Fake attempts (get flagged)</div>
        ${storyList(FAKES)}
        <p class="muted small">Also: ORD-1005 (₹199 order, so the discount is 10%) and ORD-1006 (offer used last month).</p>
      </aside>
    </div>`;
  const phone = el.querySelector('[data-phone]');

  phone.addEventListener('click', onClick);
  phone.addEventListener('change', (e) => {
    if (e.target.name === 'reason') {
      s.reason = e.target.value;
      phone.querySelector('[data-act="fail"]').disabled = false;
    }
  });

  const rider = () => store.state.riders.find((r) => r.rider_id === RIDER_ID);

  function render() {
    const r = rider();
    const body = { list, order, verify, redeliver, delivered }[s.screen]();
    phone.innerHTML = `
      <div class="phone">
        <div class="phone-bar rider-bar"><b>Valmo Partner</b><span>${esc(r.name)} · ${esc(get.hub(r.hub_id).hub_name)}</span></div>
        <div class="phone-body">${body}</div>
      </div>
      <div class="phone-caption">🛵 Rider's phone</div>`;
  }

  // ---------- screens ----------

  function orderCard(o) {
    const c = get.customer(o.customer_id);
    return `
      <div class="card tight">
        <div class="row"><b>${o.order_id}</b><span class="chip grey">${o.payment_mode === 'COD' ? `COD ${rs(o.order_value)}` : 'Prepaid'}</span></div>
        <div>${esc(c.name)} · ${esc(o.product_name)}</div>
        <div class="muted small">${esc(o.address)}</div>
      </div>`;
  }

  function list() {
    const mine = store.state.orders.filter((o) => o.rider_id === RIDER_ID);
    const todo = mine.filter((o) => o.status === 'in_transit');
    const again = mine.filter((o) => o.status === 'rescheduled');
    return `
      <div class="section-title">To deliver (${todo.length})</div>
      ${todo.map((o) => `
        <button class="order-item" data-order="${o.order_id}">
          <div class="row"><b>${o.order_id}</b><span class="chip grey">COD ${rs(o.order_value)}</span></div>
          <div>${esc(get.customer(o.customer_id).name)}</div>
          <div class="muted small">${esc(o.address)}</div>
          ${o.reattempt_required ? '<span class="chip bad">Flagged: go back and re-attempt</span>' : ''}
        </button>`).join('') || '<p class="muted small">Nothing left to deliver.</p>'}
      <div class="section-title">Re-deliveries (${again.length})</div>
      ${again.map((o) => `
        <button class="order-item" data-redeliver="${o.order_id}">
          <div class="row"><b>${o.order_id}</b>${o.payment_mode === 'UPI' ? '<span class="chip ok">Prepaid</span>' : `<span class="chip grey">COD ${rs(o.order_value)}</span>`}</div>
          <div>${esc(get.customer(o.customer_id).name)}</div>
          <div class="small">🗓 ${esc(fmtSlot(latestCaseForOrder(o.order_id).chosen_slot))}</div>
        </button>`).join('') || '<p class="muted small">No re-deliveries scheduled.</p>'}`;
  }

  function order() {
    const o = get.order(s.orderId);
    return `
      <button class="link" data-act="back">← Deliveries</button>
      ${orderCard(o)}
      <div class="section-title">Couldn't deliver? Select a reason</div>
      ${Object.entries(REASON_LABELS).map(([k, label]) => `
        <label class="radio"><input type="radio" name="reason" value="${k}" ${s.reason === k ? 'checked' : ''}> ${label}</label>`).join('')}
      <button class="btn primary block" data-act="fail" ${s.reason ? '' : 'disabled'}>Mark delivery failed</button>
      <p class="muted small center-text">📍 Location and 📞 call log are checked automatically.</p>`;
  }

  function verify() {
    const a = s.result.attempt;
    const v = a.verification;
    const cfg = store.state.config;
    const phone = esc(get.customer(get.order(a.order_id).customer_id).phone);
    const line = (i, icon, loading, done, ok) => {
      if (s.phase < i) return '';
      if (s.phase === i) return `<div class="fetch"><span class="spinner"></span><span>${icon} ${loading}</span></div>`;
      return `<div class="fetch ${ok ? 'pass' : 'fail'}"><span>${ok ? '✓' : '✗'}</span><span>${done}</span></div>`;
    };
    const verdict = s.phase < 2 ? '' : s.result.case
      ? `<div class="verdict ok reveal">
           <b>Attempt verified</b>
           <div>Take the parcel back to ${esc(get.hub(a.hub_id).hub_name)}. It is <b>held</b>, not returned.</div>
           <div>The customer has been messaged on WhatsApp.</div>
         </div>`
      : `<div class="verdict bad reveal">
           <b>Not accepted</b>
           ${v.failures.map((f) => `<div>• ${esc(f)}</div>`).join('')}
           <div>Go back and attempt the delivery. Your hub manager has been notified.</div>
         </div>`;
    return `
      <div class="section-title">${esc(a.order_id)} · ${REASON_LABELS[a.reason_selected]}</div>
      ${line(0, '📍', 'Getting your location…', `You are <b>${fmtDist(v.distance_m)}</b> from the address (limit ${cfg.GPS_THRESHOLD_M} m)`, v.gps_pass)}
      ${line(1, '📞', 'Checking call log…', a.call_duration_sec
        ? `Called ${phone} for <b>${a.call_duration_sec} s</b> (min ${cfg.CALL_MIN_SEC} s)`
        : `<b>No call</b> to ${phone} (min ${cfg.CALL_MIN_SEC} s)`, v.call_pass)}
      ${verdict}
      ${s.phase >= 2 ? '<button class="btn block reveal" data-act="back">Back to deliveries</button>' : ''}`;
  }

  function redeliver() {
    const o = get.order(s.orderId);
    const rc = latestCaseForOrder(o.order_id);
    return `
      <button class="link" data-act="back">← Deliveries</button>
      ${orderCard(o)}
      <div class="card tight">
        <div class="muted small">Delivery slot</div>
        <b>🗓 ${esc(fmtSlot(rc.chosen_slot))}</b>
        <div class="muted small" style="margin-top:8px">Payment</div>
        ${rc.payment ? `<b class="ok-text">Prepaid ${rs(rc.payment.amount)} by UPI. Nothing to collect.</b>` : `<b>Collect COD ${rs(o.order_value)}</b>`}
      </div>
      <button class="btn primary block" data-act="deliver">✓ Mark delivered</button>`;
  }

  function delivered() {
    return `
      <div class="verdict ok reveal"><b>Delivered ✓</b><div>${esc(s.orderId)} handed over. Nice work!</div></div>
      <button class="btn block" data-act="back">Back to deliveries</button>`;
  }

  // ---------- actions ----------

  async function onClick(e) {
    const orderBtn = e.target.closest('[data-order]');
    if (orderBtn) return go('order', orderBtn.dataset.order);
    const againBtn = e.target.closest('[data-redeliver]');
    if (againBtn) return go('redeliver', againBtn.dataset.redeliver);

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') go('list');
    if (act === 'fail') markFailed();
    if (act === 'deliver') deliver();
  }

  function go(screen, orderId = s.orderId) {
    clearInterval(s.timer);
    Object.assign(s, { screen, orderId, reason: screen === 'order' ? null : s.reason });
    render();
  }

  async function markFailed() {
    if (s.busy) return;
    s.busy = true;
    try {
      s.result = await api.markFailed(s.orderId, s.reason);
      s.phase = 0;
      go('verify');
      s.timer = setInterval(() => {
        s.phase++;
        if (s.phase >= 2) {
          clearInterval(s.timer);
          announce();
        }
        render();
      }, STEP_MS);
    } catch (err) {
      toast(err.message);
    } finally {
      s.busy = false;
    }
  }

  // Point the presenter to the perspective where the story continues.
  async function announce() {
    await refresh(true);
    const { attempt, case: rc } = s.result;
    if (rc) {
      setNext({
        text: `${firstName(rc.customer_id)} has just received a WhatsApp message asking what happened.`,
        href: `#/customer/${rc.customer_id}`,
        label: 'Open Customer view',
      });
    } else {
      setNext({ text: `Attempt on ${attempt.order_id} was flagged. The hub manager can see it.`, href: '#/hub', label: 'Open Hub Manager view' });
    }
  }

  async function deliver() {
    if (s.busy) return;
    s.busy = true;
    try {
      const rc = latestCaseForOrder(s.orderId);
      await api.caseAction(rc.case_id, 'deliver');
      go('delivered');
      await refresh(true);
      setNext({ text: 'Delivered, and the RTO avoided. See the full journey of this parcel.', href: `#/hub/case/${rc.case_id}`, label: 'Open in Hub Manager' });
    } catch (err) {
      toast(err.message);
    } finally {
      s.busy = false;
    }
  }

  render();
  // Only the list reflects outside changes; don't disturb a screen the rider is using.
  const unsub = subscribe(() => s.screen === 'list' && render());
  return () => {
    clearInterval(s.timer);
    unsub();
  };
}
