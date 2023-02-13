import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/static';

// https://astro.build/config
export default defineConfig({
  publicDir: './public',
  site: 'https://widnyana.web.id',
  trailingSlash: 'ignore',
  output: 'static',
  adapter: vercel(),
  build: {
    format: 'directory'
  },
  markdown: {
    drafts: false,
    syntaxHighlight: 'shiki',
    remarkPlugins: [
      'remark-lint'
    ]
  },
});