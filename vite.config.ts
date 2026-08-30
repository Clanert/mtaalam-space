import { sites } from '@openai/sites-vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function mtaalamAssets() {
  return {
    name: 'mtaalam-static-assets',
    generateBundle(this: any) {
      for (const file of ['index.html', 'manifest.webmanifest', 'sw.js']) {
        this.emitFile({ type: 'asset', fileName: file === 'index.html' ? 'mtaalam.html' : file, source: readFileSync(file) });
      }
      for (const file of readdirSync('icons')) {
        this.emitFile({ type: 'asset', fileName: join('icons', file).replace(/\\/g, '/'), source: readFileSync(join('icons', file)) });
      }
    },
  };
}

const localBindingConfig = {
  main: 'vinext/server/app-router-entry',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: [],
  r2_buckets: [],
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    plugins: [
      vinext(),
      sites(),
      mtaalamAssets(),
      cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] }, config: localBindingConfig }),
    ],
  };
});
