import { esc, rs, fmtTime, fmtSlot } from './ui.js';

// Customer-facing WhatsApp copy in English and Hindi.
const DICT = {
  en: {
    undelivered_confirm: 'Hi {name}, we missed you at {time} today while delivering *{product}* ({amount}). Was this a missed delivery?',
    btn_yes_reschedule: 'Yes, reschedule',
    btn_not_right: "No, that's not right",
    slots_prompt: 'No problem! Your parcel is safe at our {hub}. Choose a new delivery slot:',
    btn_dont_want: "I don't want this order",
    slot_choice: '{slot}',
    slot_confirmed: "Confirmed ✅ We'll deliver on *{slot}*.",
    refused_confirm: 'Hi {name}, our delivery partner reported that you refused *{product}* ({amount}) at {time} today. Did you refuse this order?',
    btn_yes: 'Yes',
    btn_mistake: "No, that's a mistake",
    escalated: "Thanks for telling us. We've flagged this to our hub team, and a supervisor will call you shortly.",
    offer_title: 'Still want it? One-time offer 🎁',
    offer_sub: "Pay online now and we'll deliver again at a time that suits you.",
    offer_value: 'Order value',
    offer_discount: 'Discount',
    offer_pay: 'You pay',
    btn_pay: 'Pay {amount} by UPI',
    btn_no_thanks: 'No thanks',
    payment_ok: 'Payment of {amount} received ✅ (Ref {ref}). Choose a delivery slot:',
    return_notice: 'Okay. Your order will be returned to the seller.',
    cod_paused_notice: 'Note: Cash on Delivery is paused on your account until your next prepaid order is delivered.',
    no_response_notice: "We didn't hear back within 72 hours, so your order is being returned to the seller.",
    delivered_notice: 'Delivered! Thanks for shopping with us 🎉',
    business: 'Business account',
    typing: 'typing…',
  },
  hi: {
    undelivered_confirm: 'नमस्ते {name}, आज {time} बजे *{product}* ({amount}) की डिलीवरी के समय हम आपसे नहीं मिल पाए। क्या आपकी डिलीवरी छूट गई?',
    btn_yes_reschedule: 'हाँ, नया समय चुनें',
    btn_not_right: 'नहीं, यह सही नहीं है',
    slots_prompt: 'कोई बात नहीं! आपका पार्सल हमारे {hub} पर सुरक्षित है। नया डिलीवरी समय चुनें:',
    btn_dont_want: 'मुझे यह ऑर्डर नहीं चाहिए',
    slot_confirmed: 'पक्का ✅ हम *{slot}* को डिलीवर करेंगे।',
    refused_confirm: 'नमस्ते {name}, हमारे डिलीवरी पार्टनर के अनुसार आपने आज {time} बजे *{product}* ({amount}) लेने से मना किया। क्या आपने यह ऑर्डर मना किया था?',
    btn_yes: 'हाँ',
    btn_mistake: 'नहीं, यह गलती है',
    escalated: 'बताने के लिए धन्यवाद। हमने यह हब टीम को भेज दिया है, एक सुपरवाइज़र जल्द ही आपको कॉल करेंगे।',
    offer_title: 'अब भी चाहिए? एक बार का ऑफ़र 🎁',
    offer_sub: 'अभी ऑनलाइन भुगतान करें, हम आपके चुने समय पर दोबारा डिलीवर करेंगे।',
    offer_value: 'ऑर्डर मूल्य',
    offer_discount: 'छूट',
    offer_pay: 'आप चुकाएँगे',
    btn_pay: 'UPI से {amount} चुकाएँ',
    btn_no_thanks: 'नहीं, धन्यवाद',
    payment_ok: '{amount} का भुगतान मिल गया ✅ (Ref {ref})। डिलीवरी का समय चुनें:',
    return_notice: 'ठीक है। आपका ऑर्डर विक्रेता को वापस भेज दिया जाएगा।',
    cod_paused_notice: 'ध्यान दें: अगला प्रीपेड ऑर्डर डिलीवर होने तक आपके खाते पर कैश ऑन डिलीवरी बंद रहेगी।',
    no_response_notice: '72 घंटे में आपका जवाब नहीं मिला, इसलिए आपका ऑर्डर विक्रेता को वापस भेजा जा रहा है।',
    delivered_notice: 'डिलीवर हो गया! हमारे साथ खरीदारी के लिए धन्यवाद 🎉',
    business: 'बिज़नेस अकाउंट',
    typing: 'टाइप कर रहे हैं…',
  },
};

// Turn raw server params (ISO times, numbers, slot objects) into display strings.
function formatParams(params = {}, lang) {
  const out = { ...params };
  if (params.time) out.time = fmtTime(params.time, lang);
  if (params.slot) out.slot = fmtSlot(params.slot, lang);
  if (params.amount != null) out.amount = rs(params.amount);
  return out;
}

// Returns safe HTML: text is escaped, then *bold* markers become <b>.
export function t(key, params, lang = 'en') {
  const template = DICT[lang]?.[key] ?? DICT.en[key] ?? key;
  const values = formatParams(params, lang);
  const filled = template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
  return esc(filled).replace(/\*(.+?)\*/g, '<b>$1</b>');
}
