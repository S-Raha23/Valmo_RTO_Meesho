const cfg = require('../config');
const { haversineMeters } = require('../lib/geo');
const { fmtDist } = require('../lib/format');

// Verification Engine: a failed-delivery claim counts only if the rider was
// physically at the door (GPS) AND actually tried to reach the customer (call log).
function verifyAttempt({ pin, gps, callDurationSec }) {
  const distance = Math.round(haversineMeters(pin, gps));
  const gpsPass = distance <= cfg.GPS_THRESHOLD_M;
  const callPass = callDurationSec >= cfg.CALL_MIN_SEC;

  const failures = [];
  if (!gpsPass) failures.push(`Rider was ${fmtDist(distance)} from the drop pin (limit ${cfg.GPS_THRESHOLD_M} m)`);
  if (!callPass) {
    failures.push(callDurationSec
      ? `Call to customer lasted only ${callDurationSec} s (minimum ${cfg.CALL_MIN_SEC} s)`
      : `No call to the customer in the call log (minimum ${cfg.CALL_MIN_SEC} s)`);
  }

  return {
    distance_m: distance,
    gps_pass: gpsPass,
    call_pass: callPass,
    status: failures.length ? 'flagged' : 'verified',
    failures,
  };
}

module.exports = { verifyAttempt };
