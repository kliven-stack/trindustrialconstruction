// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

const SITE = process.env.PUBLIC_SITE_URL || 'https://trindustrialconstruction.com';

export default defineConfig({
  site: SITE,

  // Fully static: the only form on the site posts straight from the browser to the
  // Growthmap endpoint, so nothing needs a server runtime (playbook §4b).
  output: 'static',

  trailingSlash: 'always',
  build: { format: 'directory' },

  integrations: [
    sitemap({
      // Match what Yoast listed: every page. The theme's 404 template is a route,
      // not a page, so it stays out.
      filter: (page) => !/\/404\//.test(page),
    }),
  ],

  vite: { plugins: [tailwindcss()] },
});
