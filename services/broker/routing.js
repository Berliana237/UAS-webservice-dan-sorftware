'use strict';
/** Routing topik ke antrian. Pola memakai wildcard di akhir, seperti topic exchange. */
const BINDINGS = [
  { queue: 'booking.events', patterns: ['payment.succeeded', 'payment.failed', 'trip.cancelled'] },
  { queue: 'payment.events', patterns: ['payment.refund_required', 'booking.cancelled'] },
  { queue: 'notification.events', patterns: ['booking.*', 'payment.*', 'seat.lock.expired', 'trip.*', 'test.*'] },
  { queue: 'audit.events', patterns: ['audit.*', 'security.*'] },
];

const matches = (pattern, topic) => (pattern.endsWith('.*') ? topic.startsWith(pattern.slice(0, -1)) : pattern === topic);
const resolveQueues = (topic, bindings = BINDINGS) => bindings.filter((b) => b.patterns.some((p) => matches(p, topic))).map((b) => b.queue);

module.exports = { BINDINGS, matches, resolveQueues };
