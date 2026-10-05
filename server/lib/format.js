const TZ = 'Asia/Kolkata';

const round2 = (n) => Math.round(n * 100) / 100;
const rs = (n) => '₹' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
const iso = (t) => new Date(t).toISOString();
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

const time = (d) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const day = (d) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });

const fmtDateTime = (t) => `${day(new Date(t))}, ${time(new Date(t))}`;
const fmtSlot = (slot) => `${day(new Date(slot.start))}, ${time(new Date(slot.start))} – ${time(new Date(slot.end))}`;

module.exports = { TZ, round2, rs, iso, fmtDist, fmtDateTime, fmtSlot };
