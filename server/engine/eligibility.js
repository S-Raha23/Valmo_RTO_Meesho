const cfg = require('../config');

const DAY = 24 * 3600 * 1000;

function countWithin(dates, now, days) {
  return dates.filter((d) => {
    const age = now - Date.parse(d);
    return age >= 0 && age < days * DAY;
  }).length;
}

// Customer History Service: counts verified refusals in rolling windows and
// decides whether a second-chance offer may be shown.
function evaluateEligibility(customer, now) {
  const refusals90d = countWithin(customer.refusal_dates, now, 90);
  const refusals12mo = countWithin(customer.refusal_dates, now, 365);

  const lastOffer = customer.last_offer_used_date ? Date.parse(customer.last_offer_used_date) : null;
  const daysSinceOffer = lastOffer == null ? null : Math.floor((now - lastOffer) / DAY);
  const offerOnCooldown = daysSinceOffer != null && daysSinceOffer < cfg.OFFER_COOLDOWN_DAYS;

  const reasons = [];
  if (refusals12mo >= cfg.REFUSAL_CAP_12MO) {
    reasons.push(`${refusals12mo} verified refusals in the last 12 months (must be fewer than ${cfg.REFUSAL_CAP_12MO})`);
  }
  if (offerOnCooldown) {
    reasons.push(`Offer already used ${daysSinceOffer} days ago (limit: once per ${cfg.OFFER_COOLDOWN_DAYS} days)`);
  }

  return {
    refusals_90d: refusals90d,
    refusals_12mo: refusals12mo,
    days_since_offer: daysSinceOffer,
    offer_on_cooldown: offerOnCooldown,
    eligible: reasons.length === 0,
    reasons,
  };
}

module.exports = { evaluateEligibility };
