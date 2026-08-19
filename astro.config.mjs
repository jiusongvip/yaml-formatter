import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [preact({ compat: true }), sitemap()],
  output: 'static',
  site: 'https://www.yaml-formatter.com',
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()],
  },
});