// Signed-out screen, and the Account dialog: usage, activity log and (for administrators) users.

import { t, lang, setLang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
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
const fmt = (n) => Number(n || 0).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
const when = (ts) => (ts ? new Date(ts).toLocaleString(lang === 'zh' ? 'zh-CN' : [], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

async function call(path, options = {}) {
  const res = await fetch(path, { ...options, headers: options.body ? { 'content-type': 'application/json' } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(t(data.error) || t('Request failed ({status})', { status: res.status }));
  return data;
}

// ---------- Log in / sign up ----------

export function showAuth({ signupOpen }) {
  let mode = 'login';
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
  $('authLang').textContent = lang === 'zh' ? 'English' : '中文';
  $('authLang').addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh'));
  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('authError');
    const fail = (text, field) => ((err.textContent = text), (err.hidden = false), field?.focus());
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(t('Enter a valid email address'), $('authEmail'));
    if (password.length < 8) return fail(t('The password needs at least 8 characters'), $('authPassword'));
    $('authSubmit').disabled = true;
    try {
      await call(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body: { email, password, name: $('authName').value.trim() } });
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

const ACTIVITY = {
  'auth.signup': 'Signed up',
  'auth.login': 'Logged in',
  'auth.login_failed': 'Failed log-in attempt',
  'auth.logout': 'Logged out',
  'script.generate': 'Wrote a script',
  'script.failed': 'Script failed',
  'script.stopped': 'Stopped a script',
  'script.download': 'Downloaded a package',
  'image.generate': 'Generated images',
  'video.generate': 'Started a video',
  'gateway.create': 'Added a gateway',
  'gateway.update': 'Changed a gateway',
  'gateway.delete': 'Deleted a gateway',
  'admin.user_update': 'Updated a user',
};
const KIND = { script: 'Scripts', image: 'Images', video: 'Videos', test: 'Connection tests' };

function activityDetail(a) {
  const d = a.detail || {};
  return [
    d.title || d.topic,
    d.gateway,
    d.target && `${d.target}${d.disabled ? ` · ${t('disabled')}` : ''}${d.role ? ` · ${t(d.role === 'admin' ? 'Administrator' : 'Member')}` : ''}`,
    d.made != null && t('{made} of {requested} images', d),
    d.seconds && `${d.seconds}s`,
    d.model,
    d.email && a.type === 'auth.login_failed' && d.email,
    d.error || (a.type === 'auth.login_failed' && t(d.reason)),
  ]
    .filter(Boolean)
    .join(' · ');
}

const table = (head, rows) =>
  el(
    'div',
    { class: 'table-wrap' },
    el('table', { class: 'table' }, el('thead', {}, el('tr', {}, head.map(([label, cls]) => el('th', { class: cls || '', scope: 'col' }, label)))), el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((c, i) => el('td', { class: head[i][1] || '' }, c)))))),
  );
const block = (title, node) => el('section', {}, el('h3', { class: 'block-title' }, title), node);
const empty = (text) => el('p', { class: 'hint' }, text);
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
    all && block(t('By user'), u.byUser.length ? table([[t('User'), 'wrap'], ...NUM_HEAD()], u.byUser.map((g) => [el('span', {}, g.name || '—', el('span', { class: 'sub' }, g.email)), ...numbers(g)])) : empty(t('No usage in this period.'))),
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

const activityView = (a) => [
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

function usersView(data, me, reload) {
  const change = async (u, patch) => {
    try {
      await call('/api/admin/users/update', { method: 'POST', body: { id: u.id, ...patch } });
    } catch (err) {
      alert(err.message);
    }
    reload();
  };
  return [
    table(
      [[t('User'), 'wrap'], [t('Role'), ''], [t('Status'), ''], [t('Joined'), ''], [t('Last log-in'), ''], [t('Scripts'), 'num'], [t('Model calls'), 'num'], [t('Tokens'), 'num'], [t('Images'), 'num'], ['', '']],
      data.users.map((u) => {
        const self = u.id === me.id;
        const g = u.usage || {};
        return [
          el('span', {}, u.name, el('span', { class: 'sub' }, u.email)),
          el('span', { class: `badge${u.role === 'admin' ? ' accent' : ''}` }, t(u.role === 'admin' ? 'Administrator' : 'Member')),
          el('span', { class: `badge${u.disabled ? ' bad' : ''}` }, t(u.disabled ? 'Disabled' : 'Active')),
          when(u.createdAt),
          when(u.lastLoginAt),
          fmt(u.scripts),
          fmt(g.calls),
          fmt((g.inputTokens || 0) + (g.outputTokens || 0)),
          fmt(g.images),
          self
            ? el('span', { class: 'hint' }, t('You'))
            : el(
                'span',
                { class: 'actions' },
                el('button', { class: 'btn small', type: 'button', onclick: () => change(u, { role: u.role === 'admin' ? 'user' : 'admin' }) }, t(u.role === 'admin' ? 'Make member' : 'Make administrator')),
                el('button', { class: `btn small${u.disabled ? '' : ' danger'}`, type: 'button', onclick: () => change(u, { disabled: !u.disabled }) }, t(u.disabled ? 'Enable' : 'Disable')),
              ),
        ];
      }),
    ),
  ];
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
    $('accountScope').hidden = tab === 'users';
    try {
      if (tab === 'usage') panel.replaceChildren(...usageView(await call(`/api/usage?scope=${scope()}&days=${$('accountDays').value}`), platformName).filter(Boolean));
      else if (tab === 'activity') panel.replaceChildren(...activityView(await call(`/api/activity?scope=${scope()}&limit=300`)));
      else panel.replaceChildren(...usersView(await call('/api/admin/users'), user, load));
    } catch (err) {
      panel.replaceChildren(el('p', { class: 'error', role: 'alert' }, err.message));
    }
  }

  $('accountName').textContent = user.name;
  $('accountFullName').textContent = user.name;
  $('accountEmail').textContent = user.email;
  $('accountAvatar').textContent = (user.name || user.email).trim()[0] || '?';
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
