// An expected, user-facing error (bad input or an illegal state transition).
class FlowError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = { FlowError };
