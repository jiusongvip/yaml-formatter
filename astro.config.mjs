import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [preact({ compat: true }), sitemap()],
  output: 'static',
  site: 'https://yaml-formatter.com',
  trailingSlash: 'never',
  vite: {
    plugins: [tailwindcss()],
  },
});