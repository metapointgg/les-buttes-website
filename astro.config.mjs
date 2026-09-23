import { defineConfig } from 'astro/config';
export default defineConfig({ site: 'https://lesbuttes.com', output: 'static', build: { format: 'directory' }, trailingSlash: 'always' });
