// Signed-out screen, and the Account dialog: usage, activity log and your own profile.
// The helpers exported here are shared with the admin page (admin.js).

import { t, lang, explain } from './i18n.js';
import { wireLang, enhancePasswords, concealPassword } from './shell.js';

const $ = (id) => document.getElementById(id);
export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
};
export const fmt = (n) => Number(n || 0).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
export const when = (ts) => (ts ? new Date(ts).toLocaleString(lang === 'zh' ? 'zh-CN' : [], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export async function call(path, options = {}) {
  const res = await fetch(path, { ...options, headers: options.body ? { 'content-type': 'application/json' } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(t(data.error) || t('Request failed ({status})', { status: res.status }), data.cause));
  return data;
}

// ---------- Log in / sign up ----------

/**
 * Ask the browser to offer saving the login that just worked. Chromium browsers take it from here;
 * Safari and Firefox have no such call and decide from the form itself (named fields, autocomplete
 * hints, a real password field). Never blocks or fails the log-in.
 */
async function offerToSave(email, password) {
  if (!window.PasswordCredential || !navigator.credentials?.store) return;
  try {
    const stored = navigator.credentials.store(new PasswordCredential({ id: email, password, name: email }));
    await Promise.race([stored, new Promise((done) => setTimeout(done, 1500))]);
  } catch {
    // The browser declined (saving is off, private window, ...): nothing to do.
  }
}

export function showAuth({ signupOpen }) {
  // The home page links to app.html#signup so "Create an account" opens on the right tab.
  let mode = signupOpen && location.hash === '#signup' ? 'signup' : 'login';
  const sync = () => {
    const signup = mode === 'signup';
    $('authTabLogin').setAttribute('aria-selected', String(!signup));
    $('authTabSignup').setAttribute('aria-selected', String(signup));
    $('authNameField').hidden = !signup;
    $('authPwHint').hidden = !signup;
    $('authPassword').autocomplete = signup ? 'new-password' : 'current-password';
    $('authTitle').textContent = signup ? t('Create your account') : t('Welcome back');
    $('authSub').textContent = signup ? t('Sign up to write short-video scripts for every platform you publish on.') : t('Log in to write short-video scripts for every platform you publish on.');
    $('authSubmitLabel').textContent = signup ? t('Create account') : t('Log in');
    $('authError').hidden = true;
  };
  $('authTabSignup').hidden = !signupOpen;
  $('authClosed').hidden = signupOpen;
  $('authTabLogin').addEventListener('click', () => ((mode = 'login'), sync()));
  $('authTabSignup').addEventListener('click', () => ((mode = 'signup'), sync()));
  wireLang($('authLang'));
  enhancePasswords($('authScreen'));
  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('authError');
    const fail = (text, field) => ((err.textContent = text), (err.hidden = false), field?.focus());
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(t('Enter a valid email address'), $('authEmail'));
    if (password.length < 8) return fail(t('The password needs at least 8 characters'), $('authPassword'));
    $('authSubmit').disabled = true;
    concealPassword($('authPassword'));
    try {
      await call(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body: { email, password, name: $('authName').value.trim() } });
      await offerToSave(email, password);
      location.reload();
    } catch (ex) {
      fail(ex.message, $('authPassword'));
      $('authSubmit').disabled = false;
    }
  });
  sync();
  document.body.dataset.auth = 'out';
  $('authEmail').focus();
}

// ---------- Account dialog ----------

export const ACTIVITY = {
  'auth.signup': 'Signed up',
  'auth.login': 'Logged in',
  'auth.login_failed': 'Failed log-in attempt',
  'auth.logout': 'Logged out',
  'script.generate': 'Wrote a script',
  'script.failed': 'Script failed',
  'script.stopped': 'Stopped a script',
  'script.download': 'Downloaded a package',
  'narration.draft': 'Drafted a narration',
  'narration.refine': 'Refined a narration',
  'narration.failed': 'Narration failed',
  'image.generate': 'Generated images',
  'style.suggest': 'Had the model pick a visual style',
  'video.generate': 'Started a video',
  'gateway.create': 'Added a gateway',
  'gateway.update': 'Changed a gateway',
  'gateway.delete': 'Deleted a gateway',
  'gateway.select': 'Switched the gateway in use',
  'auth.profile_update': 'Changed their name',
  'auth.password_change': 'Changed their password',
  'admin.user_create': 'Created a user',
  'admin.user_update': 'Updated a user',
  'admin.user_password': "Reset a user's password",
  'admin.user_logout': 'Logged a user out everywhere',
  'admin.user_delete': 'Deleted a user',
};
const KIND = { script: 'Scripts', narration: 'Narration', style: 'Style picks', image: 'Images', video: 'Videos', test: 'Connection tests' };

export function activityDetail(a) {
  const d = a.detail || {};
  return [
    d.title || d.topic,
    d.gateway,
    d.target && `${d.target}${d.disabled ? ` · ${t('disabled')}` : ''}${d.role ? ` · ${t(d.role === 'admin' ? 'Administrator' : 'Member')}` : ''}`,
    d.scripts != null && t(d.kept ? '{n} scripts moved to the administrator' : '{n} scripts deleted', { n: d.scripts }),
    d.was && t('was {email}', { email: d.was }),
    d.made != null && t('{made} of {requested} images', d),
    d.seconds && `${d.seconds}s`,
    d.model,
    d.email && a.type === 'auth.login_failed' && d.email,
    d.error || (a.type === 'auth.login_failed' && t(d.reason)),
  ]
    .filter(Boolean)
    .join(' · ');
}

export const table = (head, rows) =>
  el(
    'div',
    { class: 'table-wrap' },
    el('table', { class: 'table' }, el('thead', {}, el('tr', {}, head.map(([label, cls]) => el('th', { class: cls || '', scope: 'col' }, label)))), el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((c, i) => el('td', { class: head[i][1] || '' }, c)))))),
  );
export const block = (title, node) => el('section', {}, el('h3', { class: 'block-title' }, title), node);
export const empty = (text) => el('p', { class: 'hint' }, text);
const numbers = (g) => [fmt(g.calls), fmt(g.inputTokens), fmt(g.outputTokens), fmt(g.images), fmt(g.videos)];
const NUM_HEAD = () => [[t('Calls'), 'num'], [t('Tokens in'), 'num'], [t('Tokens out'), 'num'], [t('Images'), 'num'], [t('Videos'), 'num']];

function usageView(u, platformName) {
  const all = u.scope === 'all';
  const T = u.total;
  return [
    el(
      'div',
      { class: 'stats' },
      [[T.calls, 'Model calls'], [T.inputTokens, 'Tokens in'], [T.outputTokens, 'Tokens out'], [T.images, 'Images'], [T.videos, 'Videos'], [T.failed, 'Failed calls']].map(([n, label]) => el('div', { class: 'stat' }, el('b', {}, fmt(n)), el('span', {}, t(label)))),
    ),
    T.estimated > 0 && empty(t('{n} of these calls had no token count from the provider, so their tokens are estimated from the text.', { n: fmt(T.estimated) })),
    all && block(t('By user'), u.byUser.length ? table([[t('User'), 'wrap'], ...NUM_HEAD()], u.byUser.map((g) => [el('span', {}, g.name || t('Deleted user'), el('span', { class: 'sub' }, g.email)), ...numbers(g)])) : empty(t('No usage in this period.'))),
    block(
      t('By script'),
      u.byTask.length
        ? table(
            [[t('Script'), 'wrap'], [t('Last call'), ''], ...NUM_HEAD()],
            u.byTask.map((g) => [el('span', {}, g.title || t('Untitled script'), el('span', { class: 'sub' }, [platformName(g.platformId), all && g.email].filter(Boolean).join(' · '))), when(g.lastTs), ...numbers(g)]),
          )
        : empty(t('No scripts in this period.')),
    ),
    block(t('By model'), u.byModel.length ? table([[t('Gateway and model'), 'wrap'], ...NUM_HEAD()], u.byModel.map((g) => [el('span', {}, g.model || '—', el('span', { class: 'sub' }, g.gateway)), ...numbers(g)])) : empty(t('No usage in this period.'))),
    block(
      t('Latest calls'),
      u.recent.length
        ? table(
            [[t('When'), ''], all && [t('User'), ''], [t('Kind'), ''], [t('Model'), ''], [t('Tokens in'), 'num'], [t('Tokens out'), 'num'], [t('Images'), 'num'], [t('Result'), 'wrap']].filter(Boolean),
            u.recent.slice(0, 50).map((r) =>
              [when(r.ts), all && r.email, t(KIND[r.kind] || r.kind), r.model, `${fmt(r.inputTokens)}${r.estimated ? ' ≈' : ''}`, `${fmt(r.outputTokens)}${r.estimated ? ' ≈' : ''}`, fmt(r.images), r.ok ? t('OK') : el('span', { class: 'log-what bad' }, r.error || t('Failed'))].filter((c) => c !== false),
            ),
          )
        : empty(t('No usage in this period.')),
    ),
  ];
}

export const activityView = (a) => [
  a.items.length
    ? el(
        'div',
        { class: 'log' },
        a.items.map((x) =>
          el(
            'div',
            { class: 'log-row' },
            el('span', { class: 'log-time' }, when(x.ts)),
            el('div', {}, el('span', { class: `log-what${/failed/.test(x.type) ? ' bad' : ''}` }, t(ACTIVITY[x.type] || x.type)), a.scope === 'all' && x.email && el('span', { class: 'log-detail' }, ` · ${x.email}`), el('div', { class: 'log-detail' }, activityDetail(x))),
          ),
        ),
      )
    : empty(t('Nothing has happened yet.')),
];

/** A labelled input. */
export const field = (label, input, hint) => el('label', { class: 'field' }, el('span', {}, label), input, hint && el('span', { class: 'hint' }, hint));
/** A status line that a form writes its result into. */
export function statusLine() {
  const node = el('p', { class: 'status', role: 'status', hidden: true });
  const say = (text, kind = '') => ((node.textContent = text), (node.className = `status ${kind}`), (node.hidden = !text));
  return { node, ok: (text) => say(text, 'ok'), bad: (text) => say(text, 'bad'), clear: () => say('') };
}

/** Your own name and password. */
function profileView(user, onRenamed) {
  const name = el('input', { type: 'text', maxlength: 80, value: user.name, autocomplete: 'name' });
  const nameStatus = statusLine();
  const current = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const next = el('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const pwStatus = statusLine();

  const profile = el(
    'form',
    { class: 'form-stack', onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await call('/api/auth/profile', { method: 'POST', body: { name: name.value } });
        onRenamed(r.user);
        nameStatus.ok(t('Saved.'));
      } catch (err) {
        nameStatus.bad(err.message);
      }
    } },
    field(t('Name'), name),
    field(t('Email'), el('input', { type: 'email', value: user.email, disabled: true }), t('Ask an administrator to change your email.')),
    nameStatus.node,
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, t('Save'))),
  );
  const password = el(
    'form',
    { class: 'form-stack', onsubmit: async (e) => {
      e.preventDefault();
      if (next.value.length < 8) return pwStatus.bad(t('The password needs at least 8 characters'));
      try {
        await call('/api/auth/password', { method: 'POST', body: { current: current.value, password: next.value } });
        current.value = next.value = '';
        pwStatus.ok(t('Password changed. Your other devices have been logged out.'));
      } catch (err) {
        pwStatus.bad(err.message);
      }
    } },
    field(t('Current password'), current),
    field(t('New password'), next, t('At least 8 characters.')),
    pwStatus.node,
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, t('Change password'))),
  );
  enhancePasswords(password);
  return [block(t('Profile'), profile), block(t('Change password'), password)];
}

/** Wire the Account dialog. Returns a function that opens it. */
export function wireAccount({ user, storage, platformName, openSettings }) {
  let tab = 'usage';
  const admin = user.role === 'admin';
  const scope = () => (admin ? $('accountScope').value : 'me');

  async function load() {
    const panel = $('accountPanel');
    panel.replaceChildren(empty(t('Loading…')));
    $('accountDays').hidden = tab !== 'usage';
    $('accountScope').hidden = tab === 'profile';
    try {
      if (tab === 'usage') panel.replaceChildren(...usageView(await call(`/api/usage?scope=${scope()}&days=${$('accountDays').value}`), platformName).filter(Boolean));
      else if (tab === 'activity') panel.replaceChildren(...activityView(await call(`/api/activity?scope=${scope()}&limit=300`)));
      else panel.replaceChildren(...profileView(user, renamed));
    } catch (err) {
      panel.replaceChildren(el('p', { class: 'error', role: 'alert' }, err.message));
    }
  }

  const renamed = (u) => {
    Object.assign(user, { name: u.name });
    $('accountName').textContent = user.name;
    $('accountFullName').textContent = user.name;
    $('accountAvatar').textContent = (user.name || user.email).trim()[0] || '?';
  };
  renamed(user);
  $('accountEmail').textContent = user.email;
  $('accountRole').textContent = t(admin ? 'Administrator' : 'Member');
  $('accountRole').classList.toggle('accent', admin);
  $('storageWarning').hidden = !storage || storage.durable;
  for (const b of $('accountTabs').querySelectorAll('.seg-btn')) {
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      for (const x of $('accountTabs').querySelectorAll('.seg-btn')) x.setAttribute('aria-selected', String(x === b));
      load();
    });
  }
  $('accountScope').addEventListener('change', load);
  $('accountDays').addEventListener('change', load);
  $('closeAccount').addEventListener('click', () => $('accountDialog').close());
  $('accountSettings').addEventListener('click', () => ($('accountDialog').close(), openSettings()));
  $('logout').addEventListener('click', async () => {
    await call('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    location.reload();
  });

  return () => (load(), $('accountDialog').showModal());
}
