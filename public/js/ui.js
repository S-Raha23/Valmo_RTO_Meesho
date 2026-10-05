// Formatting helpers and shared UI bits.
export const TZ = 'Asia/Kolkata';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

export const rs = (n) => '₹' + (Number.isInteger(n) ? n : Number(n).toFixed(2));

const locale = (lang) => (lang === 'hi' ? 'hi-IN' : 'en-IN');
export const fmtTime = (iso, lang = 'en') =>
  new Date(iso).toLocaleTimeString(locale(lang), { hour: 'numeric', minute: '2-digit', timeZone: TZ });
export const fmtDay = (iso, lang = 'en') =>
  new Date(iso).toLocaleDateString(locale(lang), { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
export const fmtDateTime = (iso) => `${fmtDay(iso)}, ${fmtTime(iso)}`;
export const fmtSlot = (slot, lang = 'en') =>
  `${fmtDay(slot.start, lang)}, ${fmtTime(slot.start, lang)} – ${fmtTime(slot.end, lang)}`;

export function countdown(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  const s = Math.floor((ms % 60e3) / 1e3);
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export const STAGES = {
  awaiting_confirmation: { label: 'Awaiting response', tone: 'warn' },
  awaiting_slot: { label: 'Awaiting slot', tone: 'warn' },
  offer_sent: { label: 'Offer sent', tone: 'accent' },
  paid_awaiting_slot: { label: 'Paid · awaiting slot', tone: 'info' },
  rescheduled: { label: 'Rescheduled', tone: 'info' },
  escalated: { label: 'Escalated', tone: 'grey' },
  delivered: { label: 'Delivered again', tone: 'ok' },
  returned: { label: 'Returning', tone: 'bad' },
  flagged: { label: 'Flagged attempt', tone: 'bad' },
};

// Stages that can still lapse into a return if the customer never answers.
export const EXPIRABLE = ['awaiting_confirmation', 'awaiting_slot', 'offer_sent'];
export const CLOSED = ['delivered', 'returned', 'escalated'];

export const REASON_LABELS = {
  not_available: 'Customer not available',
  refused: 'Customer refused',
  other: 'Other (address / access issue)',
};

export const chip = (label, tone = 'grey') => `<span class="chip ${tone}">${esc(label)}</span>`;
export const stageChip = (stage) => chip(STAGES[stage].label, STAGES[stage].tone);
export const typeChip = (type) =>
  `<span class="tag ${type}">${type === 'refused' ? 'Refused' : type === 'undelivered' ? 'Undelivered' : 'Unverified'}</span>`;
export const deadline = (iso) => `<span class="countdown" data-deadline="${iso}">${countdown(iso)}</span>`;

let toastTimer;
export function toast(message, tone = 'bad') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3200);
}

// One ticker keeps every hold-window countdown on the page live.
setInterval(() => {
  document.querySelectorAll('[data-deadline]').forEach((el) => {
    el.textContent = countdown(el.dataset.deadline);
    el.classList.toggle('urgent', Date.parse(el.dataset.deadline) - Date.now() < 6 * 3600e3);
  });
}, 1000);
