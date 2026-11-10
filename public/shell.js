// Pieces shared by the app and the admin page: theme and language buttons, and the
// show / hide toggle on password fields.

import { t, lang, setLang } from './i18n.js';
import { icon } from './icons.js';

/** theme.js applies the saved choice before first paint; this wires the button that changes it. */
export function wireTheme(btn) {
  const root = document.documentElement;
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const label = () => {
    const text = t(isDark() ? 'Switch to light mode' : 'Switch to dark mode');
    btn.replaceChildren(icon(isDark() ? 'sun' : 'moon'));
    btn.setAttribute('aria-label', text);
    btn.title = text;
  };
  btn.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    try {
      localStorage.setItem('video-scripter.theme', root.dataset.theme);
    } catch {}
    label();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);
  label();
}

export function wireLang(btn) {
  btn.textContent = lang === 'zh' ? 'English' : '中文';
  btn.addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh'));
}

function setShown(input, show) {
  const btn = input.parentElement.querySelector('.pw-toggle');
  input.type = show ? 'text' : 'password';
  btn.replaceChildren(icon(show ? 'eyeOff' : 'eye', 18));
  btn.setAttribute('aria-label', t(show ? 'Hide password' : 'Show password'));
  btn.title = btn.getAttribute('aria-label');
  btn.setAttribute('aria-pressed', String(show));
}

/**
 * Give every password field an eye button that shows or hides what was typed.
 * Safe to call again after adding fields; a field is only enhanced once.
 */
export function enhancePasswords(root = document) {
  for (const input of root.querySelectorAll('input[type="password"]:not([data-reveal])')) {
    input.dataset.reveal = '';
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.replaceWith(wrap);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.addEventListener('click', () => (setShown(input, input.type === 'password'), input.focus()));
    wrap.append(input, btn);
    setShown(input, false);
  }
}

/** Show a revealed field's content (used after generating a password, so it can be copied). */
export const revealPassword = (input) => setShown(input, true);
/** Put a revealed field back to dots. A browser only offers to save a field that is a password field when the form is sent. */
export const concealPassword = (input) => setShown(input, false);

// A dialog that closes hides its passwords again, so nothing stays readable on screen.
document.addEventListener('close', (e) => e.target.querySelectorAll?.('input[data-reveal]').forEach((i) => setShown(i, false)), true);
