// Expression builders for `eval` and `wait` steps: each returns JavaScript SOURCE run in the
// page. Apps rarely have stable selectors on what a picture needs, so most of these find
// things by their visible text. A project adds its own in .showcase/finders.cjs (config
// "finders"); they land on the recipe context next to these.
const j = JSON.stringify;

// The element whose own text is exactly `t` (trimmed). The FIRST in document order: behind
// an open modal that is often the page underneath, so pass `inside` (JS for a root element).
const text = (t, inside = "document.body") =>
    `(() => { const w = document.createTreeWalker(${inside}, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && n.textContent.trim() !== ${j(t)}); return n ? n.parentElement : null; })()`;

// The element whose own text CONTAINS `t`.
const textHas = (t, inside = "document.body") =>
    `(() => { const w = document.createTreeWalker(${inside}, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && !n.textContent.includes(${j(t)})); return n ? n.parentElement : null; })()`;

// A button (or role=button / submit input) whose text is exactly / contains `label`, any case.
const BUTTONS = `[...document.querySelectorAll('button, [role=button], input[type=submit], input[type=button]')]`;
const label = `(b.innerText || b.value || '').trim().toLowerCase()`;
const button = (l) => `${BUTTONS}.find(b => ${label} === ${j(l.toLowerCase())})`;
const buttonHas = (l) => `${BUTTONS}.find(b => ${label}.includes(${j(l.toLowerCase())}))`;

// Clicks that fail loudly: an eval that throws stops the run and names the step.
const click = (expr, what) =>
    `(() => { const e = ${expr}; if (!e) throw new Error(${j(`not found: ${what}`)}); e.click(); return ${j(what)}; })()`;
const clickText = (t) => click(text(t), t);
const clickButton = (l) => click(button(l), l);
const clickButtonHas = (l) => click(buttonHas(l), l);
const clickSelector = (sel) => click(`document.querySelector(${j(sel)})`, sel);

// Scroll the window so the first text containing `t` sits `offset` px below the top.
const scrollToText = (t, offset = 80) =>
    `(() => { const e = ${textHas(t)}; if (!e) throw new Error(${j(`not found: ${t}`)}); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - ${offset}); return scrollY; })()`;

// Set a field's value the way frameworks hear it (Vue, React, Svelte, Alpine, plain forms):
// the native setter, then input and change events. `enter` also presses Enter.
const typeInto = (selector, value, enter = false) =>
    `(() => { const i = document.querySelector(${j(selector)}); if (!i) throw new Error(${j(`not found: ${selector}`)}); i.focus();` +
    ` const proto = i instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : i instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;` +
    ` Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${j(value)});` +
    ` i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));` +
    (enter ? ` i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); i.blur();` : "") +
    ` return ${j(value)}; })()`;

// Submit the form that holds `selector` (a login form, a search box).
const submit = (selector) =>
    `(() => { const f = document.querySelector(${j(selector)})?.closest('form'); if (!f) throw new Error(${j(`no form around ${selector}`)}); f.requestSubmit ? f.requestSubmit() : f.submit(); return 'submitted'; })()`;

// Remove elements that should not be in a picture (a dev toolbar, a cookie banner).
const hide = (selector) =>
    `(() => { const n = document.querySelectorAll(${j(selector)}); n.forEach(e => e.style.setProperty('display', 'none', 'important')); return n.length + ' hidden'; })()`;

module.exports = { text, textHas, button, buttonHas, click, clickText, clickButton, clickButtonHas, clickSelector, scrollToText, typeInto, submit, hide };
