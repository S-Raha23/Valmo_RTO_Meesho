const cfg = require('../config');
const { FlowError } = require('../lib/errors');
const { iso, rs, fmtDateTime, fmtSlot } = require('../lib/format');
const { fetchTelemetry } = require('./telemetry');
const { verifyAttempt } = require('./verification');
const { REASON_LABELS, routeFailure } = require('./router');
const { evaluateEligibility } = require('./eligibility');
const { computeOffer } = require('./offer');

const HOUR = 3600 * 1000;
const IST_OFFSET = 5.5 * HOUR;

// The recovery state machine: which actions are legal in each stage.
// Anything not listed here is rejected, so a case can never skip a step.
const TRANSITIONS = {
  awaiting_confirmation: ['confirm', 'deny', 'expire'],
  awaiting_slot: ['choose_slot', 'decline_reschedule', 'expire'],
  offer_sent: ['pay', 'decline_offer', 'expire'],
  paid_awaiting_slot: ['choose_slot'],
  rescheduled: ['deliver'],
  escalated: [],
  delivered: [],
  returned: [],
};

const ORDER_STATUS = {
  awaiting_confirmation: 'held',
  awaiting_slot: 'held',
  offer_sent: 'held',
  paid_awaiting_slot: 'held',
  escalated: 'held',
  rescheduled: 'rescheduled',
  delivered: 'delivered',
  returned: 'returned',
};

const RETURN_REASONS = {
  no_response: `No customer response within the ${cfg.HOLD_WINDOW_HOURS} h hold window`,
  declined_reschedule: 'Customer declined to reschedule',
  declined_offer: 'Customer declined the second-chance offer',
  ineligible: 'Not eligible for a second-chance offer',
};

// ---------- helpers ----------

function nextId(db, key, prefix) {
  db.counters[key] = (db.counters[key] || 0) + 1;
  return `${prefix}-${String(db.counters[key]).padStart(4, '0')}`;
}

function context(db, orderId) {
  const order = db.orders.find((o) => o.order_id === orderId);
  const customer = db.customers.find((c) => c.customer_id === order.customer_id);
  const hub = db.hubs.find((h) => h.hub_id === order.hub_id);
  return { order, customer, hub };
}

const event = (rc, now, e) => rc.events.push({ at: iso(now), tone: 'info', ...e });
const bot = (rc, now, key, params = {}) => rc.messages.push({ from: 'bot', key, params, at: iso(now) });
const user = (rc, now, key, params = {}) => rc.messages.push({ from: 'user', key, params, at: iso(now) });

function setStage(rc, order, stage) {
  rc.stage = stage;
  order.status = ORDER_STATUS[stage];
}

// Three delivery slots in IST: tomorrow morning, tomorrow evening, day-after morning.
function slotOptions(now) {
  const ist = new Date(now + IST_OFFSET);
  const at = (dayOffset, hour) =>
    iso(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + dayOffset, hour) - IST_OFFSET);
  return [
    { id: 'S1', start: at(1, 10), end: at(1, 13) },
    { id: 'S2', start: at(1, 14), end: at(1, 18) },
    { id: 'S3', start: at(2, 10), end: at(2, 13) },
  ];
}

function closeReturned(rc, order, now, reason, detail) {
  setStage(rc, order, 'returned');
  rc.final_outcome = 'returned';
  rc.return_reason = reason;
  rc.return_reason_label = RETURN_REASONS[reason];
  rc.return_detail = detail || null;
  rc.closed_at = iso(now);
  event(rc, now, {
    step: 'Returned',
    tone: 'bad',
    title: `Return to origin: ${RETURN_REASONS[reason]}`,
    detail,
  });
}

// ---------- step 1-3: rider submits a failed attempt ----------

function submitAttempt(db, input, now) {
  const order = db.orders.find((o) => o.order_id === input.order_id);
  if (!order) throw new FlowError(`Unknown order ${input.order_id}`, 404);
  if (order.status !== 'in_transit') throw new FlowError(`Order ${order.order_id} is ${order.status}, not out for delivery`, 409);
  if (!REASON_LABELS[input.reason]) throw new FlowError('Select a failure reason');

  const { customer, hub } = context(db, order.order_id);
  const attemptNo = db.attempts.filter((a) => a.order_id === order.order_id).length;
  const { gps, call } = fetchTelemetry(order, customer, attemptNo);
  const callSec = call.duration_sec;

  const v = verifyAttempt({ pin: order.drop_pin, gps, callDurationSec: callSec });
  const attempt = {
    attempt_id: nextId(db, 'attempt', 'ATT'),
    order_id: order.order_id,
    rider_id: order.rider_id,
    hub_id: order.hub_id,
    timestamp: iso(now),
    reason_selected: input.reason,
    gps_lat: gps.lat,
    gps_lng: gps.lng,
    gps_distance_to_pin_m: v.distance_m,
    call_duration_sec: callSec,
    call_to: call.to,
    verification_status: v.status,
    verification: v,
  };
  db.attempts.push(attempt);

  // Not verified: flag it, send it back for a genuine re-attempt. No case, no customer message.
  if (v.status === 'flagged') {
    order.status = 'in_transit';
    order.reattempt_required = true;
    return { attempt, case: null };
  }

  order.reattempt_required = false;
  const lane = routeFailure(input.reason);
  const rc = {
    case_id: nextId(db, 'case', 'RC'),
    order_id: order.order_id,
    customer_id: customer.customer_id,
    hub_id: order.hub_id,
    attempt_id: attempt.attempt_id,
    failure_type: lane,
    stage: null,
    confirmation_status: 'pending',
    history_check: null,
    offer_shown: false,
    offer: null,
    offer_discount_amount: null,
    offer_accepted: null,
    payment: null,
    slot_options: [],
    chosen_slot: null,
    final_outcome: null,
    return_reason: null,
    return_reason_label: null,
    return_detail: null,
    created_at: iso(now),
    hold_expires_at: iso(now + cfg.HOLD_WINDOW_HOURS * HOUR),
    closed_at: null,
    messages: [],
    events: [],
  };

  event(rc, now, { title: `Rider marked delivery failed: "${REASON_LABELS[input.reason]}"` });
  event(rc, now, {
    step: 'Verified',
    tone: 'ok',
    title: 'Attempt verified as genuine',
    detail: `GPS ${v.distance_m} m from drop pin (≤ ${cfg.GPS_THRESHOLD_M} m) · call ${callSec} s (≥ ${cfg.CALL_MIN_SEC} s)`,
  });
  event(rc, now, {
    step: lane === 'refused' ? 'Refused' : 'Undelivered',
    title: `Routed to the ${lane} lane`,
    detail: input.reason === 'other' ? 'Reason "Other" is handled as a missed delivery' : null,
  });
  event(rc, now, {
    title: `Parcel held at ${hub.hub_name}, not sent to the return queue`,
    detail: `Hold window ${cfg.HOLD_WINDOW_HOURS} h, until ${fmtDateTime(Date.parse(rc.hold_expires_at))}`,
  });
  event(rc, now, {
    title: 'Confirmation message sent on WhatsApp',
    detail: 'Simulated. Production: fires within ~2 min, voice-call fallback if unread.',
  });

  const params = {
    name: customer.name.split(' ')[0],
    product: order.product_name,
    amount: order.order_value,
    time: attempt.timestamp,
  };
  bot(rc, now, lane === 'refused' ? 'refused_confirm' : 'undelivered_confirm', params);
  setStage(rc, order, 'awaiting_confirmation');
  db.cases.push(rc);
  return { attempt, case: rc };
}

// ---------- refused lane: history check -> offer / no offer ----------

function runRefusalPolicy(rc, { order, customer }, now) {
  const history = evaluateEligibility(customer, now); // prior history, before this refusal
  rc.history_check = { ...history, checked_at: iso(now) };
  event(rc, now, {
    step: 'History checked',
    tone: history.eligible ? 'ok' : 'warn',
    title: `Refusal history: ${history.refusals_90d} in 90 days, ${history.refusals_12mo} in 12 months`,
    detail: history.eligible ? 'Eligible for a second-chance offer' : `Not eligible: ${history.reasons.join('; ')}`,
  });

  customer.refusal_dates.push(iso(now));
  event(rc, now, {
    title: 'Verified refusal recorded on customer profile',
    detail: `12-month count is now ${history.refusals_12mo + 1}`,
  });

  let codPausedNow = false;
  if (history.refusals_12mo >= cfg.REFUSAL_CAP_12MO && customer.cod_status !== 'paused') {
    customer.cod_status = 'paused';
    customer.cod_paused_at = iso(now);
    codPausedNow = true;
    event(rc, now, {
      step: 'COD paused',
      tone: 'bad',
      title: 'Cash on Delivery paused for this customer',
      detail: 'Re-enabled automatically after one prepaid order is delivered',
    });
  }

  if (history.eligible) {
    const offer = computeOffer(order.order_value, order.order_id);
    rc.offer = offer;
    rc.offer_shown = true;
    rc.offer_discount_amount = offer.discount;
    event(rc, now, {
      step: 'Offer shown',
      tone: 'accent',
      title: `Second-chance offer sent: ${rs(offer.discount)} off, pay ${rs(offer.pay_amount)} by UPI`,
      detail: `Discount = ${offer.formula} (${offer.rule_applied})`,
    });
    bot(rc, now, 'offer', { product: order.product_name, ...offer });
    setStage(rc, order, 'offer_sent');
  } else {
    event(rc, now, { step: 'No offer', tone: 'warn', title: 'No offer shown (guardrail)' });
    closeReturned(rc, order, now, 'ineligible', history.reasons.join('; '));
    bot(rc, now, 'return_notice');
    if (codPausedNow) bot(rc, now, 'cod_paused_notice');
  }
}

// ---------- step 4-5: every customer / ops action ----------

const HANDLERS = {
  confirm(rc, ctx, payload, now) {
    rc.confirmation_status = 'confirmed';
    if (rc.failure_type === 'undelivered') {
      user(rc, now, 'btn_yes_reschedule');
      event(rc, now, { step: 'Customer confirmed', tone: 'ok', title: 'Customer confirmed it was a missed delivery' });
      rc.slot_options = slotOptions(now);
      event(rc, now, { title: 'Reschedule slots offered', detail: rc.slot_options.map(fmtSlot).join(' · ') });
      bot(rc, now, 'slots_prompt', { hub: ctx.hub.hub_name });
      setStage(rc, ctx.order, 'awaiting_slot');
    } else {
      user(rc, now, 'btn_yes');
      event(rc, now, { step: 'Customer confirmed', tone: 'ok', title: 'Customer confirmed the refusal' });
      runRefusalPolicy(rc, ctx, now);
    }
  },

  deny(rc, ctx, payload, now) {
    user(rc, now, rc.failure_type === 'refused' ? 'btn_mistake' : 'btn_not_right');
    rc.confirmation_status = 'denied';
    rc.final_outcome = 'escalated';
    event(rc, now, {
      step: 'Escalated',
      tone: 'warn',
      title: "Customer disputes the rider's report: escalated to hub supervisor",
      detail: 'Mismatch between rider reason and customer answer. The system does not force a classification.',
    });
    bot(rc, now, 'escalated');
    setStage(rc, ctx.order, 'escalated');
  },

  choose_slot(rc, ctx, payload, now) {
    const slot = rc.slot_options.find((s) => s.id === payload.slot_id);
    if (!slot) throw new FlowError('Unknown delivery slot');
    user(rc, now, 'slot_choice', { slot });
    rc.chosen_slot = slot;
    event(rc, now, { step: 'Rescheduled', title: `Delivery rescheduled: ${fmtSlot(slot)}` });
    bot(rc, now, 'slot_confirmed', { slot });
    setStage(rc, ctx.order, 'rescheduled');
  },

  decline_reschedule(rc, ctx, payload, now) {
    user(rc, now, 'btn_dont_want');
    closeReturned(rc, ctx.order, now, 'declined_reschedule');
    bot(rc, now, 'return_notice');
  },

  pay(rc, ctx, payload, now) {
    const amount = rc.offer.pay_amount;
    user(rc, now, 'btn_pay', { amount });
    rc.offer_accepted = true;
    rc.payment = { ref: `UPI${String(now).slice(-9)}`, amount, at: iso(now), simulated: true };
    ctx.customer.last_offer_used_date = iso(now);
    ctx.order.payment_mode = 'UPI';
    event(rc, now, {
      step: 'Accepted',
      tone: 'ok',
      title: `Offer accepted: ${rs(amount)} paid by UPI`,
      detail: `Simulated payment, ref ${rc.payment.ref}. Order is now prepaid.`,
    });
    rc.slot_options = slotOptions(now);
    bot(rc, now, 'payment_ok', { amount, ref: rc.payment.ref });
    setStage(rc, ctx.order, 'paid_awaiting_slot');
  },

  decline_offer(rc, ctx, payload, now) {
    user(rc, now, 'btn_no_thanks');
    rc.offer_accepted = false;
    closeReturned(rc, ctx.order, now, 'declined_offer');
    bot(rc, now, 'return_notice');
  },

  expire(rc, ctx, payload, now) {
    closeReturned(rc, ctx.order, now, 'no_response', payload.auto ? 'Hold window lapsed' : 'Simulated 72 h with no reply');
    bot(rc, now, 'no_response_notice');
  },

  deliver(rc, ctx, payload, now) {
    rc.final_outcome = 'delivered_again';
    rc.closed_at = iso(now);
    event(rc, now, { step: 'Delivered', tone: 'ok', title: 'Delivered on re-attempt. RTO avoided.' });
    bot(rc, now, 'delivered_notice');
    setStage(rc, ctx.order, 'delivered');
    if (ctx.order.payment_mode === 'UPI' && ctx.customer.cod_status === 'paused') {
      ctx.customer.cod_status = 'active';
      ctx.customer.cod_paused_at = null;
      event(rc, now, { step: 'COD re-enabled', tone: 'ok', title: 'Prepaid order delivered: COD re-enabled for customer' });
    }
  },
};

function applyAction(db, caseId, type, payload, now) {
  const rc = db.cases.find((c) => c.case_id === caseId);
  if (!rc) throw new FlowError(`Unknown case ${caseId}`, 404);
  if (!TRANSITIONS[rc.stage].includes(type)) {
    throw new FlowError(`"${type}" is not allowed while the case is ${rc.stage.replace(/_/g, ' ')}`, 409);
  }
  HANDLERS[type](rc, context(db, rc.order_id), payload || {}, now);
  return rc;
}

// Returns any case whose hold window lapsed without an answer. Returns how many changed.
function sweepExpired(db, now) {
  let changed = 0;
  for (const rc of db.cases) {
    const expiresAt = Date.parse(rc.hold_expires_at);
    if (TRANSITIONS[rc.stage].includes('expire') && now >= expiresAt) {
      applyAction(db, rc.case_id, 'expire', { auto: true }, expiresAt);
      changed++;
    }
  }
  return changed;
}

module.exports = { submitAttempt, applyAction, sweepExpired, TRANSITIONS };
