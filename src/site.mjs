// The public address of the site, for the places that need an absolute URL: canonical and
// hreflang links, Open Graph tags, structured data, sitemap.xml, robots.txt and llms.txt.
//
// Those files carry SITE_TOKEN where the address goes. `npm start` fills it in on each request
// (server.mjs); a static host fills it in once at build time (scripts/stamp-site-url.mjs).

export const SITE_TOKEN = '__SITE_URL__';

/** Files in public/ that contain the token. */
export const STAMPED_FILES = ['index.html', 'zh.html', 'sitemap.xml', 'robots.txt', 'llms.txt'];

const clean = (url) => {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
};

/**
 * The address set for this deployment, or '' when none is.
 * SITE_URL wins; on Vercel the project's production domain is used when it is not set.
 */
export function configuredSiteUrl(env = process.env) {
  if (env.SITE_URL) return clean(env.SITE_URL);
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return clean(env.VERCEL_PROJECT_PRODUCTION_URL);
  return '';
}

/** The address a request came in on, for when nothing is configured (local use). */
export function requestSiteUrl(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return '';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

export const stamp = (text, siteUrl) => text.replaceAll(SITE_TOKEN, siteUrl);
