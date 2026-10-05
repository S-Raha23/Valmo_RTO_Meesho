import { store, subscribe, refresh, setNext, get, latestCaseForCustomer, firstName } from '../store.js';
import { api } from '../api.js';
import { esc, fmtSlot, toast, EXPIRABLE } from '../ui.js';
import { createChat } from '../components/chat.js';

// Customer perspective: the customer's WhatsApp, as triggered by the driver's action.
export function mount(el, customerId) {
  let selected = customerId || mostRecentCustomer();

  el.innerHTML = `
    <div class="persp">
      <div>
        <label class="viewing">Viewing as <select data-customer></select></label>
        <div data-chat></div>
      </div>
      <aside class="card notes">
        <h3>Customer's view</h3>
        <p class="muted">Within about 2 minutes of a verified failed attempt, the customer is asked on WhatsApp what happened. The parcel waits at the hub meanwhile. Nothing is returned without asking.</p>
        <div data-status></div>
      </aside>
    </div>`;

  const resolveCase = () => (selected ? latestCaseForCustomer(selected) : null);
  const chat = createChat(el.querySelector('[data-chat]'), resolveCase, { onAction: announce });

  el.querySelector('[data-customer]').addEventListener('change', (e) => {
    selected = e.target.value;
    history.replaceState(null, '', `#/customer/${selected}`);
    render();
  });

  el.querySelector('[data-status]').addEventListener('click', async (e) => {
    if (!e.target.matches('[data-act="expire"]')) return;
    const rc = resolveCase();
    try {
      const updated = await api.caseAction(rc.case_id, 'expire');
      await refresh(true);
      announce(updated);
    } catch (err) {
      toast(err.message);
    }
  });

  function mostRecentCustomer() {
    const last = [...store.state.cases].sort((a, b) => b.events.at(-1).at.localeCompare(a.events.at(-1).at))[0];
    return last?.customer_id || null;
  }

  function render() {
    // Customers who have a conversation, most recently active first.
    const withCases = [...new Set([...store.state.cases]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((c) => c.customer_id))];
    el.querySelector('[data-customer]').innerHTML = withCases
      .map((id) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(get.customer(id).name)} · ${latestCaseForCustomer(id).order_id}</option>`)
      .join('');
    chat.update();

    const rc = resolveCase();
    el.querySelector('[data-status]').innerHTML = rc && EXPIRABLE.includes(rc.stage)
      ? `<div class="ops"><span class="muted small">Customer doesn't answer?</span><button class="btn small" data-act="expire">⏱ Skip 72 h with no reply</button></div>`
      : '';
  }

  render();
  return subscribe(render);
}

// Point the presenter to the perspective where the story continues.
function announce(rc) {
  const name = firstName(rc.customer_id);
  const hubLink = { href: `#/hub/case/${rc.case_id}`, label: 'Open in Hub Manager' };
  switch (rc.stage) {
    case 'rescheduled':
      return setNext({ text: `Re-delivery booked for ${fmtSlot(rc.chosen_slot)}. It now shows in the rider's list.`, href: '#/driver', label: 'Open Driver view' });
    case 'returned':
      return setNext({ text: `${name}'s parcel is returning to the seller, and the reason is on record.`, ...hubLink });
    case 'escalated':
      return setNext({ text: `${name} says the rider's report is wrong. A hub supervisor takes over.`, ...hubLink });
    default:
      return setNext(null); // the story continues on this same screen
  }
}
