'use strict';
// Language support. "auto" follows the browser language (and its live changes);
// an explicit choice is remembered for this viewer.
const I18N = (() => {
  const KEY = 'solar11.lang';
  let pref = 'auto';
  try { pref = localStorage.getItem(KEY) || 'auto'; } catch (e) { /* storage blocked: stay on auto */ }
  const detect = () => {
    const l = ((navigator.languages && navigator.languages[0]) || navigator.language || 'en').toLowerCase();
    return l.startsWith('zh') ? 'zh' : 'en';
  };
  const listeners = [];
  const api = {
    lang: pref === 'auto' ? detect() : pref,
    get pref() { return pref; },
    setPref(p) {
      pref = p;
      try { localStorage.setItem(KEY, p); } catch (e) { /* not persisted */ }
      api.update();
    },
    update() {
      const l = pref === 'auto' ? detect() : pref;
      if (l === api.lang) return;
      api.lang = l;
      api.applyStatic();
      listeners.forEach(f => f(l));
    },
    onChange(f) { listeners.push(f); },
    // Static markup: elements carry their English in data-en (innerHTML) / data-en-title / data-en-aria
    applyStatic() {
      const en = api.lang === 'en';
      document.documentElement.lang = en ? 'en' : 'zh-CN';
      document.title = 'True Scale Solar System';
      document.querySelectorAll('[data-en]').forEach(el => {
        if (el.dataset.zh == null) el.dataset.zh = el.innerHTML;
        el.innerHTML = en ? el.dataset.en : el.dataset.zh;
      });
      for (const [attr, key] of [['title', 'enTitle'], ['aria-label', 'enAria']]) {
        document.querySelectorAll(`[data-${key === 'enTitle' ? 'en-title' : 'en-aria'}]`).forEach(el => {
          const zhKey = key === 'enTitle' ? 'zhTitle' : 'zhAria';
          if (el.dataset[zhKey] == null) el.dataset[zhKey] = el.getAttribute(attr) || '';
          el.setAttribute(attr, en ? el.dataset[key] : el.dataset[zhKey]);
        });
      }
    },
  };
  window.addEventListener('languagechange', () => { if (pref === 'auto') api.update(); });
  return api;
})();

// Pick the string for the current language
const tr = (zh, en) => I18N.lang === 'zh' ? zh : en;
// Turn obj[field] into a live bilingual property
function biProp(obj, field, zh, en) {
  Object.defineProperty(obj, field, { get: () => tr(zh, en), enumerable: true, configurable: true });
  return obj;
}

I18N.applyStatic();
