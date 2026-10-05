// Every business threshold lives here, never inline in the logic.
module.exports = {
  PORT: Number(process.env.PORT) || 3000,

  // Verification (Phase 1 fake-attempt guard)
  GPS_THRESHOLD_M: 150,   // rider must be within this distance of the drop pin
  CALL_MIN_SEC: 20,       // outbound call to the customer must last at least this long

  // Hub hold
  HOLD_WINDOW_HOURS: 72,  // parcel is held this long before an unanswered case returns

  // Second-chance offer
  DISCOUNT_CAP_RS: 25,    // discount = min(cap, pct × order value)
  DISCOUNT_PCT: 0.10,
  REFUSAL_CAP_12MO: 2,    // offer only if fewer than this many verified refusals in 12 months
  OFFER_COOLDOWN_DAYS: 90, // offer at most once per this many days
  UPI_VPA: 'valmo.recovery@upi',
};
