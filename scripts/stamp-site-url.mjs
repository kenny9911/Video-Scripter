// Build step for static hosts (vercel.json runs it): writes the site's public address into the
// home pages, sitemap.xml, robots.txt and llms.txt in public/, replacing the __SITE_URL__ token.
//
// The address is SITE_URL, or on Vercel the project's production domain. It edits the files in
// place, which is what a build checkout wants; there is no need to run it locally, because
// `npm start` fills the token in on each request instead.
//
// It never fails the build: with no address it leaves the files alone and says so.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_TOKEN, STAMPED_FILES, configuredSiteUrl, stamp } from '../src/site.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

try {
  const siteUrl = configuredSiteUrl();
  if (!siteUrl) {
    console.warn(`stamp-site-url: no SITE_URL set, so ${SITE_TOKEN} was left in place. Set SITE_URL to the public address, e.g. https://example.com`);
  } else {
    for (const name of STAMPED_FILES) {
      const file = path.join(PUBLIC, name);
      const text = await readFile(file, 'utf8');
      if (text.includes(SITE_TOKEN)) await writeFile(file, stamp(text, siteUrl));
    }
    console.log(`stamp-site-url: ${siteUrl}`);
  }
} catch (err) {
  console.warn(`stamp-site-url: skipped (${err.message})`);
}
