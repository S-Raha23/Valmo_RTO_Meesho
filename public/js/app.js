import { store, refresh, startPolling, subscribe, setNext } from './store.js';
import { api } from './api.js';
import { esc, toast } from './ui.js';
import * as driver from './views/driver.js';
import * as customer from './views/customer.js';
import * as hub from './views/hub.js';

const ROUTES = { driver, customer, hub };
const viewEl = document.getElementById('view');
const nextEl = document.getElementById('nextbar');
let unmount = null;

function route() {
  const [name, ...args] = location.hash.replace(/^#\/?/, '').split('/');
  const key = ROUTES[name] ? name : 'driver';
  // Opening the perspective the "next step" points to consumes it.
  if (store.next && store.next.href.split('/')[1] === key) store.next = null;
  unmount?.();
  viewEl.innerHTML = '';
  unmount = ROUTES[key].mount(viewEl, ...args);
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${key}`));
  renderNext();
}

function renderNext() {
  const n = store.next;
  nextEl.innerHTML = n
    ? `<div class="nextbar"><span>👉 ${esc(n.text)}</span><a class="btn primary small" href="${n.href}">${esc(n.label)} →</a><button class="close" aria-label="Dismiss">×</button></div>`
    : '';
}

nextEl.addEventListener('click', (e) => {
  if (e.target.matches('.close')) setNext(null);
});

document.getElementById('reset-btn').addEventListener('click', async () => {
  if (!confirm('Restore the sample data? Changes made in this browser will be cleared.')) return;
  try {
    await api.reset();
    store.next = null;
    await refresh(true);
    location.hash = '#/driver';
    route();
    toast('Sample data restored', 'ok');
  } catch (err) {
    toast(err.message);
  }
});

window.addEventListener('hashchange', route);
subscribe(renderNext);

await refresh(true);
if (!store.state) {
  viewEl.innerHTML = '<p class="center-text">Could not reach the server. Is <code>npm start</code> running?</p>';
} else {
  route();
  startPolling();
}
