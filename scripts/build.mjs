import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const outdir = path.join(root, 'dist');
const inkInstances = path.join(root, 'node_modules', 'ink', 'build', 'instances.js');

const inkInstancesPlugin = {
  name: 'ink-instances',
  setup(builder) {
    builder.onLoad({ filter: /[\\/]src[\\/]lib[\\/]terminal\.ts$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, 'utf8');
      const dynamic = /\(\s*await import\(new URL\('\.\/instances\.js', import\.meta\.resolve\('ink'\)\)\.href\)\s*\)\.default/;
      if (!dynamic.test(source)) throw new Error('Ink instances import not found in terminal.ts');
      const contents = `import __inkInstances from ${JSON.stringify(inkInstances)};\n${source.replace(dynamic, '__inkInstances')}`;
      return { contents, loader: 'ts' };
    });
  },
};

const inkDevtoolsPlugin = {
  name: 'ink-devtools',
  setup(builder) {
    builder.onResolve({ filter: /^\.\/devtools\.js$/ }, (args) =>
      /[\\/]ink[\\/]build$/.test(args.resolveDir) ? { path: 'ink-devtools', namespace: 'empty' } : undefined,
    );
    builder.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
  },
};

fs.rmSync(outdir, { recursive: true, force: true });

const result = await build({
  entryPoints: [path.join(root, 'src', 'cli.tsx')],
  outfile: path.join(outdir, 'cli.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  legalComments: 'none',
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  plugins: [inkInstancesPlugin, inkDevtoolsPlugin],
  logLevel: 'warning',
});

const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/^(.*node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/);
  if (match) packages.set(match[1], true);
}

const notices = [...packages.keys()]
  .map((dir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
    const file = fs.readdirSync(path.join(root, dir)).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name));
    const text = file ? fs.readFileSync(path.join(root, dir, file), 'utf8').trim() : `License: ${pkg.license ?? 'unknown'}`;
    return { name: `${pkg.name}@${pkg.version}`, text };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(
  path.join(outdir, 'THIRD-PARTY-LICENSES.txt'),
  `Cream bundles the following third-party packages.\n\n${notices.map((n) => `${'='.repeat(72)}\n${n.name}\n${'='.repeat(72)}\n\n${n.text}\n`).join('\n')}`,
);

const size = fs.statSync(path.join(outdir, 'cli.js')).size;
console.log(`dist/cli.js ${(size / 1024).toFixed(0)} KB · ${notices.length} bundled packages`);
