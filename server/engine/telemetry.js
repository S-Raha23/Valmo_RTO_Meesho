const { offsetPoint } = require('../lib/geo');

// Simulated Telemetry Service.
// In production this reads the rider phone's GPS fix and call log at the moment
// the rider taps "Mark delivery failed". The rider never enters these values.
// Here each order carries a scripted profile so every demo run is repeatable.
// A profile can be a list, one entry per attempt: e.g. a fake first attempt
// followed by a genuine re-attempt after the rider is sent back.
function fetchTelemetry(order, customer, attemptNo) {
  const profiles = [].concat(order.telemetry || { distance_m: 30, call_sec: 25 });
  const t = profiles[Math.min(attemptNo, profiles.length - 1)];
  return {
    gps: offsetPoint(order.drop_pin, t.distance_m, t.bearing ?? 70),
    call: { to: customer.phone, direction: 'outgoing', duration_sec: t.call_sec },
  };
}

module.exports = { fetchTelemetry };
