import { store, refresh, notify, get } from '../store.js';
import { api } from '../api.js';
import { esc, rs, fmtTime, fmtDay, fmtSlot, toast } from '../ui.js';
import { t } from '../i18n.js';

const FIRST_DELAY = 2000; // stands in for the "message fires within ~2 min" step
const NEXT_DELAY = 800;

// Screens 3a/3b/4: the customer's WhatsApp-style chat (simulated).
export function createChat(root, resolveCase, { onAction } = {}) {
  const shown = new Map(); // case key -> number of messages revealed so far
  let typing = false;
  let timer = null;
  let busy = false;
  let currentKey = null;

  root.addEventListener('click', onClick);

  const keyOf = (rc) => `${rc.case_id}|${rc.created_at}`;

  function update() {
    const rc = resolveCase();
    const key = rc ? keyOf(rc) : null;
    if (key !== currentKey) {
      clearTimeout(timer);
      timer = null;
      typing = false;
      currentKey = key;
    }
    if (!rc) return renderEmpty();
    // Brand-new cases animate in; older ones show their full history at once.
    if (!shown.has(key)) shown.set(key, Date.now() - Date.parse(rc.created_at) < 90000 ? 0 : rc.messages.length);
    render(rc);
    reveal(rc);
  }

  // Reveal queued messages one at a time: customer replies instantly, bot replies after "typing…".
  function reveal(rc) {
    if (timer) return;
    const key = keyOf(rc);
    const n = shown.get(key);
    if (n >= rc.messages.length) return;
    if (rc.messages[n].from === 'user') {
      shown.set(key, n + 1);
      render(rc);
      return reveal(rc);
    }
    typing = true;
    render(rc);
    timer = setTimeout(() => {
      timer = null;
      typing = false;
      shown.set(key, n + 1);
      update();
    }, n === 0 ? FIRST_DELAY : NEXT_DELAY);
  }

  function phone(inner, caption = '') {
    const lang = store.lang;
    root.innerHTML = `
      <div class="phone">
        <div class="phone-bar wa-bar">
          <div class="wa-avatar">V</div>
          <div class="wa-title"><b>Valmo Deliveries</b><span>${typing ? t('typing', {}, lang) : t('business', {}, lang)}</span></div>
          <div class="lang-toggle">
            <button data-lang="en" class="${lang === 'en' ? 'on' : ''}">EN</button><button data-lang="hi" class="${lang === 'hi' ? 'on' : ''}">हिं</button>
          </div>
        </div>
        ${inner}
      </div>
      <div class="phone-caption">${caption}</div>`;
    const body = root.querySelector('.wa-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function renderEmpty() {
    phone('<div class="wa-body"><div class="wa-empty">No messages yet.</div></div>');
  }

  function render(rc) {
    const lang = store.lang;
    const customer = get.customer(rc.customer_id);
    const n = shown.get(keyOf(rc));
    const done = n >= rc.messages.length && !typing;
    phone(`
      <div class="wa-body">
        <div class="wa-day">${fmtDay(rc.created_at, lang)}</div>
        ${rc.messages.slice(0, n).map((m) => message(m, lang)).join('')}
        ${typing ? '<div class="bubble bot typing"><i></i><i></i><i></i></div>' : ''}
      </div>
      <div class="wa-actions">${done ? actions(rc, lang) : ''}</div>`,
      `📱 ${esc(customer.name)} · ${esc(customer.phone)} · WhatsApp simulated`);
  }

  function message(m, lang) {
    const time = `<span class="ts">${fmtTime(m.at, lang)}</span>`;
    if (m.key !== 'offer') return `<div class="bubble ${m.from}">${t(m.key, m.params, lang)}${time}</div>`;
    const o = m.params;
    return `
      <div class="bubble bot offer">
        <b>${t('offer_title', {}, lang)}</b>
        <div class="small">${t('offer_sub', {}, lang)}</div>
        <table>
          <tr><td>${t('offer_value', {}, lang)}</td><td><s>${rs(o.order_value)}</s></td></tr>
          <tr><td>${t('offer_discount', {}, lang)}</td><td class="ok-text">−${rs(o.discount)}</td></tr>
          <tr class="total"><td>${t('offer_pay', {}, lang)}</td><td>${rs(o.pay_amount)}</td></tr>
        </table>
        <div class="formula">Discount = ${esc(o.formula)}</div>
        ${time}
      </div>`;
  }

  function actions(rc, lang) {
    const btn = (act, key, params = {}, extra = '') => `<button class="qr" data-act="${act}" ${extra}>${t(key, params, lang)}</button>`;
    const slots = () => rc.slot_options.map((s) => `<button class="qr" data-act="choose_slot" data-slot="${s.id}">🗓 ${esc(fmtSlot(s, lang))}</button>`).join('');
    switch (rc.stage) {
      case 'awaiting_confirmation':
        return rc.failure_type === 'refused'
          ? btn('confirm', 'btn_yes') + btn('deny', 'btn_mistake')
          : btn('confirm', 'btn_yes_reschedule') + btn('deny', 'btn_not_right');
      case 'awaiting_slot':
        return slots() + btn('decline_reschedule', 'btn_dont_want');
      case 'paid_awaiting_slot':
        return slots();
      case 'offer_sent':
        return btn('pay', 'btn_pay', { amount: rc.offer.pay_amount }, 'data-primary') + btn('decline_offer', 'btn_no_thanks');
      default:
        return '';
    }
  }

  async function onClick(e) {
    const langBtn = e.target.closest('[data-lang]');
    if (langBtn) {
      store.lang = langBtn.dataset.lang;
      return notify();
    }
    const b = e.target.closest('[data-act]');
    const rc = resolveCase();
    if (!b || !rc || busy) return;
    busy = true;
    root.querySelectorAll('.qr').forEach((x) => (x.disabled = true));
    try {
      if (b.dataset.act === 'pay') {
        b.textContent = 'Processing UPI payment…';
        await new Promise((r) => setTimeout(r, 1200)); // simulated gateway
      }
      const updated = await api.caseAction(rc.case_id, b.dataset.act, { slot_id: b.dataset.slot });
      await refresh(true);
      onAction?.(updated);
    } catch (err) {
      toast(err.message);
      update();
    } finally {
      busy = false;
    }
  }

  return { update };
}
