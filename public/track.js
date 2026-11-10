// Counts visits and the steps toward signing up, for the Visitors tab on the admin page.
// First-party only: it posts to this site's own /api/track and nothing else. A page opts in with
// <html data-page="home | zh | app">; a link to the app is counted with data-cta="where".
(() => {
  const page = document.documentElement.dataset.page;
  if (!page) return;
  const send = (data) => {
    try {
      fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p: page, ...data }), keepalive: true, credentials: 'same-origin' }).catch(() => {});
    } catch {}
  };

  const query = new URLSearchParams(location.search);
  let ref = '';
  try {
    const from = new URL(document.referrer);
    if (from.host !== location.host) ref = from.host;
  } catch {}
  send({ e: 'view', ref, src: query.get('utm_source') || '', med: query.get('utm_medium') || '', camp: query.get('utm_campaign') || '' });

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[data-cta]');
    if (link) send({ e: 'cta', cta: link.dataset.cta });
  });
})();
