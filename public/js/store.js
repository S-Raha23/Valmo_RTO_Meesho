import { api } from './api.js';

// Client-side cache of server state. The server is the source of truth, so every
// perspective (driver, customer, hub) sees the same data. Views re-render on change.
const listeners = new Set();

export const store = {
  state: null,
  lang: 'en',
  // "Next step" hint that links one perspective to the next, so the demo reads as a story.
  next: null,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  listeners.forEach((fn) => fn(store.state));
}

export async function refresh(force = false) {
  try {
    const next = await api.state();
    const changed = force || !store.state || next.version !== store.state.version;
    store.state = next;
    if (changed) notify();
  } catch (err) {
    console.warn('State refresh failed', err);
  }
}

export function startPolling(ms = 2000) {
  setInterval(refresh, ms);
}

export function setNext(next) {
  store.next = next;
  notify();
}

const find = (list, key) => (id) => store.state?.[list].find((x) => x[key] === id);
export const get = {
  order: find('orders', 'order_id'),
  customer: find('customers', 'customer_id'),
  hub: find('hubs', 'hub_id'),
  attempt: find('attempts', 'attempt_id'),
  case: find('cases', 'case_id'),
};

export const latestCaseForOrder = (orderId) => store.state.cases.filter((c) => c.order_id === orderId).at(-1);
export const latestCaseForCustomer = (customerId) => store.state.cases.filter((c) => c.customer_id === customerId).at(-1);
export const firstName = (customerId) => get.customer(customerId).name.split(' ')[0];
