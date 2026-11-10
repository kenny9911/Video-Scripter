// The admin page: every account, with create, edit, role, status, password reset,
// log out everywhere, delete, and each person's usage and recent activity.

import { t, applyI18n } from './i18n.js';
import { hydrateIcons, icon } from './icons.js';
import { wireTheme, wireLang, enhancePasswords, revealPassword } from './shell.js';
import { el, call, fmt, when, table, block, empty, field, statusLine, activityView } from './account.js';

const $ = (id) => document.getElementById(id);
const state = { me: null, users: [] };

function toast(msg) {
  const node = $('toast');
  node.textContent = msg;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (node.hidden = true), 2200);
}

const roleName = (role) => t(role === 'admin' ? 'Administrator' : 'Member');
const badge = (text, cls = '') => el('span', { class: `badge ${cls}` }, text);
const roleBadge = (u) => badge(roleName(u.role), u.role === 'admin' ? 'accent' : '');
const statusBadge = (u) => badge(t(u.disabled ? 'Disabled' : 'Active'), u.disabled ? 'bad' : '');
const avatar = (u) => el('span', { class: 'avatar', 'aria-hidden': 'true' }, (u.name || u.email).trim()[0] || '?');
const who = (u) => el('span', { class: 'user-cell' }, avatar(u), el('span', { class: 'account-who' }, el('b', {}, u.name, u.id === state.me.id && el('span', { class: 'hint' }, ` (${t('You')})`)), el('span', { class: 'hint' }, u.email)));

/** A password nobody has to think up: 16 characters, no look-alikes. */
function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(16)), (n) => alphabet[n % alphabet.length]).join('');
}
function generateInto(input) {
  input.value = randomPassword();
  revealPassword(input);
  input.select();
}

// ---------- The list ----------

async function load() {
  state.users = (await call('/api/admin/users')).users;
  render();
}

function render() {
  const all = state.users;
  $('userStats').replaceChildren(
    ...[
      [all.length, 'Users'],
      [all.filter((u) => !u.disabled).length, 'Active'],
      [all.filter((u) => u.role === 'admin').length, 'Administrators'],
      [all.filter((u) => u.disabled).length, 'Disabled'],
      [all.filter((u) => u.sessions > 0).length, 'Signed in now'],
      [all.reduce((n, u) => n + u.scripts, 0), 'Scripts'],
    ].map(([n, label]) => el('div', { class: 'stat' }, el('b', {}, fmt(n)), el('span', {}, t(label)))),
  );

  const q = $('userSearch').value.trim().toLowerCase();
  const role = $('userRole').value;
  const status = $('userStatus').value;
  const rows = all.filter((u) => (!q || `${u.name} ${u.email}`.toLowerCase().includes(q)) && (!role || u.role === role) && (!status || (status === 'disabled') === u.disabled));
  $('userTable').replaceChildren(
    rows.length
      ? table(
          [[t('User'), ''], [t('Role'), ''], [t('Status'), ''], [t('Joined'), 'col-opt'], [t('Last log-in'), 'col-opt'], [t('Scripts'), 'num'], [t('Model calls'), 'num col-opt'], [t('Tokens'), 'num col-opt'], [t('Images'), 'num col-opt'], ['', '']],
          rows.map((u) => {
            const g = u.usage || {};
            return [who(u), roleBadge(u), statusBadge(u), when(u.createdAt), when(u.lastLoginAt), fmt(u.scripts), fmt(g.calls), fmt((g.inputTokens || 0) + (g.outputTokens || 0)), fmt(g.images), el('button', { class: 'btn small', type: 'button', onclick: () => openUser(u.id) }, t('Manage'))];
          }),
        )
      : empty(all.length ? t('No user matches those filters.') : t('No users yet.')),
  );
}

// ---------- One user ----------

async function openUser(id) {
  const body = $('userDialogBody');
  body.replaceChildren(empty(t('Loading…')));
  if (!$('userDialog').open) $('userDialog').showModal();
  let d;
  try {
    d = await call(`/api/admin/users/detail?id=${encodeURIComponent(id)}`);
  } catch (err) {
    return body.replaceChildren(el('p', { class: 'error', role: 'alert' }, err.message));
  }
  const u = d.user;
  const self = u.id === state.me.id;
  const post = (path, payload) => call(path, { method: 'POST', body: { id: u.id, ...payload } });
  const refresh = async () => (await load(), openUser(u.id));
  $('userDialogTitle').textContent = u.name;

  // Profile, role and status
  const name = el('input', { type: 'text', maxlength: 80, value: u.name });
  const email = el('input', { type: 'email', value: u.email, inputmode: 'email', required: true });
  const role = el('select', { disabled: self }, el('option', { value: 'user', selected: u.role === 'user' }, t('Member')), el('option', { value: 'admin', selected: u.role === 'admin' }, t('Administrator')));
  const status = el('select', { disabled: self }, el('option', { value: 'active', selected: !u.disabled }, t('Active')), el('option', { value: 'disabled', selected: u.disabled }, t('Disabled (cannot log in)')));
  const profileStatus = statusLine();
  const profile = el(
    'form',
    { class: 'form-stack', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      try {
        await post('/api/admin/users/update', { name: name.value, email: email.value, ...(!self && { role: role.value, disabled: status.value === 'disabled' }) });
        toast(t('Saved.'));
        refresh();
      } catch (err) {
        profileStatus.bad(err.message);
      }
    } },
    el('div', { class: 'row' }, field(t('Name'), name), field(t('Email'), email)),
    el('div', { class: 'row' }, field(t('Role'), role), field(t('Status'), status)),
    self && el('p', { class: 'hint' }, t('This is your own account, so its role and status cannot be changed here.')),
    profileStatus.node,
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, t('Save changes'))),
  );

  // Password
  const pw = el('input', { type: 'password', autocomplete: 'new-password', minlength: 8, 'aria-label': t('New password') });
  const pwStatus = statusLine();
  const password = el(
    'form',
    { class: 'form-stack', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (pw.value.length < 8) return pwStatus.bad(t('The password needs at least 8 characters'));
      try {
        await post('/api/admin/users/password', { password: pw.value });
        pwStatus.ok(t('Password set. Send it to {name} yourself; they have been logged out everywhere.', { name: u.name }));
        load();
      } catch (err) {
        pwStatus.bad(err.message);
      }
    } },
    el('div', { class: 'inline' }, pw, el('button', { class: 'btn', type: 'button', onclick: () => generateInto(pw) }, t('Generate')), el('button', { class: 'btn primary', type: 'submit' }, t('Set password'))),
    el('span', { class: 'hint' }, t('At least 8 characters. Send it to the person yourself; it is not emailed.')),
    pwStatus.node,
  );

  // Sessions
  const sessions = el(
    'div',
    { class: 'line' },
    el('span', {}, d.sessions ? t('{n} active sessions', { n: d.sessions }) : t('Not signed in anywhere.')),
    el('button', {
      class: 'btn', type: 'button', disabled: !d.sessions,
      onclick: async () => {
        await post('/api/admin/users/logout').catch((err) => toast(err.message));
        toast(t('Logged out everywhere'));
        refresh();
      },
    }, icon('logout', 16), el('span', {}, t('Log out everywhere'))),
  );

  // Usage and activity
  const T = d.usage.total;
  const usage = el('div', { class: 'stats' }, [[d.scripts, 'Scripts'], [T.calls, 'Model calls'], [T.inputTokens, 'Tokens in'], [T.outputTokens, 'Tokens out'], [T.images, 'Images'], [T.videos, 'Videos']].map(([n, label]) => el('div', { class: 'stat' }, el('b', {}, fmt(n)), el('span', {}, t(label)))));

  // Delete
  const keep = el('select', {}, el('option', { value: 'delete' }, t('Delete their {n} scripts and all media', { n: d.scripts })), el('option', { value: 'transfer' }, t('Move their {n} scripts to my account', { n: d.scripts })));
  const danger = el(
    'div',
    { class: 'danger-zone' },
    self
      ? el('p', { class: 'hint' }, t('You cannot delete your own account.'))
      : [
          d.scripts > 0 && field(t('Their work'), keep),
          el('p', { class: 'hint' }, t('Usage and activity records are kept as the audit trail. This cannot be undone.')),
          el('div', { class: 'actions' }, el('button', {
            class: 'btn danger', type: 'button',
            onclick: async () => {
              if (!confirm(t('Delete the account {email}? This cannot be undone.', { email: u.email }))) return;
              try {
                await post('/api/admin/users/delete', { scripts: keep.value });
                $('userDialog').close();
                toast(t('User deleted'));
                load();
              } catch (err) {
                toast(err.message);
              }
            },
          }, icon('trash', 16), el('span', {}, t('Delete user')))),
        ],
  );

  body.replaceChildren(
    el('div', { class: 'account-card' }, avatar(u), el('div', { class: 'account-who' }, el('b', {}, u.name), el('span', { class: 'hint' }, u.email)), roleBadge(u), statusBadge(u), el('span', { class: 'spacer' }), el('span', { class: 'hint' }, `${t('Joined')} ${when(u.createdAt)} · ${t('Last log-in')} ${when(u.lastLoginAt)}`)),
    block(t('Profile and access'), profile),
    block(t('Reset password'), password),
    block(t('Sessions'), sessions),
    block(t('Usage, all time'), usage),
    block(t('Recent activity'), el('div', {}, activityView({ scope: 'me', items: d.activity }))),
    block(t('Delete account'), danger),
  );
  enhancePasswords(body);
}

// ---------- New user ----------

function wireNewUser() {
  const dialog = $('newUserDialog');
  const status = $('newUserStatus');
  $('newUser').addEventListener('click', () => {
    $('newUserForm').reset();
    status.hidden = true;
    dialog.showModal();
    $('newName').focus();
  });
  for (const id of ['closeNewUser', 'cancelNewUser']) $(id).addEventListener('click', () => dialog.close());
  $('newGenerate').addEventListener('click', () => generateInto($('newPassword')));
  $('newUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await call('/api/admin/users/create', { method: 'POST', body: { name: $('newName').value, email: $('newEmail').value, password: $('newPassword').value, role: $('newRole').value } });
      dialog.close();
      toast(t('Created {email}', { email: r.user.email }));
      await load();
    } catch (err) {
      status.textContent = err.message;
      status.hidden = false;
    }
  });
}

// ---------- Start ----------

async function boot() {
  applyI18n();
  hydrateIcons();
  wireTheme($('themeToggle'));
  wireLang($('langToggle'));
  const me = await call('/api/auth/me');
  if (!me.user) return location.replace('./');
  state.me = me.user;
  document.body.dataset.role = me.user.role;
  document.body.dataset.auth = 'in';
  $('adminLogout').addEventListener('click', async () => {
    await call('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    location.replace('./');
  });
  if (me.user.role !== 'admin') {
    document.querySelector('.admin').hidden = true;
    $('adminDenied').hidden = false;
    return;
  }
  enhancePasswords();
  wireNewUser();
  for (const id of ['userSearch', 'userRole', 'userStatus']) $(id).addEventListener('input', render);
  $('closeUser').addEventListener('click', () => $('userDialog').close());
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', (e) => e.target === d && d.close());
  await load();
}

boot().catch((err) => {
  document.body.dataset.auth = 'in';
  $('userTable').replaceChildren(el('p', { class: 'error', role: 'alert' }, err.message));
});
