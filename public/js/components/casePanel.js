import { store, refresh, get } from '../store.js';
import { api } from '../api.js';
import { esc, rs, fmtTime, fmtDateTime, fmtSlot, toast, stageChip, typeChip, deadline, EXPIRABLE, CLOSED } from '../ui.js';

// Hub manager's view of one case: outcome, key facts and the full timeline.
export function createCasePanel(root, resolveCase) {
  root.addEventListener('click', async (e) => {
    const rc = resolveCase();
    if (!e.target.matches('[data-act="expire"]') || !rc) return;
    e.target.disabled = true;
    try {
      await api.caseAction(rc.case_id, 'expire');
      await refresh(true);
    } catch (err) {
      toast(err.message);
    }
  });

  function update() {
    const rc = resolveCase();
    root.innerHTML = `<div class="card panel">${rc ? body(rc) : '<p class="muted">Case not found. It may have been cleared by "Reset demo".</p>'}</div>`;
  }

  function body(rc) {
    const order = get.order(rc.order_id);
    const customer = get.customer(rc.customer_id);
    const attempt = get.attempt(rc.attempt_id);
    const facts = [
      ['Customer', `${esc(customer.name)} <span class="muted">· COD ${customer.cod_status === 'paused' ? '<b class="bad-text">paused</b>' : 'active'}</span>`],
      ['Order', `${esc(order.product_name)} · ${rs(order.order_value)}`],
      ['Verification', `<span class="ok-text">✓</span> ${attempt.gps_distance_to_pin_m} m from address · ${attempt.call_duration_sec} s call`],
    ];
    if (EXPIRABLE.includes(rc.stage)) facts.push(['Hold time left', `${deadline(rc.hold_expires_at)} <span class="muted">of ${store.state.config.HOLD_WINDOW_HOURS} h</span>`]);
    if (rc.history_check) {
      const h = rc.history_check;
      facts.push(['History check', `${h.refusals_12mo} refusals in 12 months → ${h.eligible ? '<b class="ok-text">eligible</b>' : '<b class="bad-text">not eligible</b>'}`]);
    }
    if (rc.offer) facts.push(['Offer', `Pay ${rs(rc.offer.pay_amount)} by UPI<div class="formula">Discount = ${esc(rc.offer.formula)}</div>`]);
    if (rc.chosen_slot) facts.push(['Re-delivery slot', esc(fmtSlot(rc.chosen_slot))]);

    const path = rc.events.filter((e) => e.step).map((e) => `<span class="step ${e.tone}">${esc(e.step)}</span>`).join('<span class="arrow">→</span>');

    return `
      <div class="panel-head">
        <div><div class="muted small">Recovery case ${rc.case_id}</div><h3>${rc.order_id}</h3></div>
        <div class="row gap">${typeChip(rc.failure_type)} ${stageChip(rc.stage)}</div>
      </div>
      ${CLOSED.includes(rc.stage) ? outcome(rc, path) : `<div class="path">${path}</div>`}
      <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${EXPIRABLE.includes(rc.stage) ? '<div class="ops"><span class="muted small">Demo shortcut</span><button class="btn small" data-act="expire">⏱ Skip 72 h with no reply</button></div>' : ''}
      <div class="section-title">Timeline</div>
      <ol class="timeline">
        ${rc.events.map((e) => `
          <li class="${e.tone}">
            <b>${esc(e.title)}</b>
            ${e.detail ? `<div class="muted small">${esc(e.detail)}</div>` : ''}
            <div class="muted tiny-text" title="${fmtDateTime(e.at)}">${fmtTime(e.at)}</div>
          </li>`).join('')}
      </ol>`;
  }

  function outcome(rc, path) {
    const [tone, title] = {
      delivered: ['ok', 'Delivered again. RTO avoided.'],
      returned: ['bad', 'Returned to seller'],
      escalated: ['grey', 'Escalated to hub supervisor'],
    }[rc.stage];
    const why = rc.stage === 'returned'
      ? `<div><b>Why:</b> ${esc(rc.return_reason_label)}${rc.return_detail ? `. ${esc(rc.return_detail)}` : ''}</div>`
      : '';
    return `<div class="outcome ${tone}"><b>${title}</b>${why}<div class="path">${path}</div></div>`;
  }

  return { update };
}
