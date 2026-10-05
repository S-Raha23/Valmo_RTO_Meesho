const cfg = require('../config');
const { round2, rs } = require('../lib/format');

// Offer Engine: discount = min(₹25, 10% × order value), paid upfront by UPI.
function computeOffer(orderValue, orderId) {
  const pctAmount = round2(orderValue * cfg.DISCOUNT_PCT);
  const discount = Math.min(cfg.DISCOUNT_CAP_RS, pctAmount);
  const payAmount = round2(orderValue - discount);
  const pctLabel = `${Math.round(cfg.DISCOUNT_PCT * 100)}%`;

  return {
    order_value: orderValue,
    pct_amount: pctAmount,
    cap: cfg.DISCOUNT_CAP_RS,
    discount,
    pay_amount: payAmount,
    rule_applied: pctAmount >= cfg.DISCOUNT_CAP_RS ? `flat ${rs(cfg.DISCOUNT_CAP_RS)} cap` : `${pctLabel} of order value`,
    formula: `min(${rs(cfg.DISCOUNT_CAP_RS)}, ${pctLabel} × ${rs(orderValue)} = ${rs(pctAmount)}) = ${rs(discount)}`,
    // Fake payment link: shaped like a real UPI intent, never actually processed.
    payment_link: `upi://pay?pa=${cfg.UPI_VPA}&pn=Valmo%20Recovery&am=${payAmount.toFixed(2)}&cu=INR&tn=${orderId}`,
  };
}

module.exports = { computeOffer };
