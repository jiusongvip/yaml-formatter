import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [react(), sitemap()],
  output: 'static',
  site: 'https://yaml-formatter.com',
  trailingSlash: 'never',
  vite: {
    plugins: [tailwindcss()],
  },
});
