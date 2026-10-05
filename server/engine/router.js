// Failure-Type Router: the rider's selected reason decides the recovery lane.
const REASON_LABELS = {
  not_available: 'Customer not available',
  refused: 'Customer refused',
  other: 'Other (address / access issue)',
};

const LANES = {
  not_available: 'undelivered',
  refused: 'refused',
  other: 'undelivered', // anything that is not a refusal is treated as a missed delivery
};

const routeFailure = (reason) => LANES[reason];

module.exports = { REASON_LABELS, routeFailure };
