import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { scopeOpenReelCss } from './scope-openreel-css.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'lib', 'client.js')
const metafileOutput = process.argv.find(arg => arg.startsWith('--metafile='))?.slice('--metafile='.length)
const openreel = join(root, 'src/client/openreel')
const tailwindConfig = (await import(pathToFileURL(join(root, 'tailwind.openreel.config.js')).href)).default
tailwindConfig.content = [join(root, 'src/client/**/*.{js,jsx,ts,tsx}')]

const envStub = {
  DEV: false,
  MODE: 'production',
  PROD: true,
  SSR: false,
  BASE_URL: '/',
  VITE_PUBLIC_POSTHOG_KEY: '',
  VITE_PUBLIC_POSTHOG_HOST: '',
  VITE_CLOUD_API_URL: '',
  VITE_OPENREEL_TTS_URL: '',
  VITE_ENABLE_SW: '',
  VITE_OPENREEL_AUTH_BROKER_BASE_URL: '',
  VITE_OPENREEL_GPU_BASE_URL: '',
  VITE_OPENREEL_E2E: '',
}

const define = {
  'import.meta.env': JSON.stringify(envStub),
  'import.meta.hot': 'undefined',
  'process.env.NODE_ENV': '"production"',
}
const assetLoaders = { '.wasm': 'dataurl', '.wgsl': 'text' }
const resolvePackage = createRequire(import.meta.url).resolve

function insideVendor(filename) {
  const path = relative(openreel, filename)
  return Boolean(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

function stubPlugin(filter, contents, loader = 'js') {
  return {
    name: `stub:${filter}`,
    setup(build) {
      build.onResolve({ filter }, (args) => ({
        path: args.path,
        namespace: `stub:${filter.source}`,
      }))
      build.onLoad({ filter: /.*/, namespace: `stub:${filter.source}` }, () => ({
        contents,
        loader,
      }))
    },
  }
}

const tailwindPlugin = {
  name: 'openreel-tailwind',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = readFileSync(args.path, 'utf8')
      const vendor = insideVendor(args.path)
      const css = vendor ? source.replace(/url\((['"])(\.\.?\/[^'"\s]+\.woff2)\1\)/g, (_match, _quote, name) => {
        const font = resolve(dirname(args.path), name)
        if (!insideVendor(font)) throw new Error(`Editor font is outside the vendor tree: ${name}`)
        return `url("data:font/woff2;base64,${readFileSync(font).toString('base64')}")`
      }) : source
      const result = await postcss([
        tailwindcss(tailwindConfig),
        autoprefixer(),
        ...(vendor ? [scopeOpenReelCss()] : []),
      ]).process(css, { from: args.path })
      const stylesheet = relative(join(root, 'src/client'), args.path).split(sep).join('/')
      const injected = `(() => {
  if (typeof document === "undefined") return;
  const id = ${JSON.stringify('omnimux-clip-css:' + stylesheet)};
  if (document.getElementById(id)) {
    try { document.getElementById(id).remove(); } catch {}
  }
  const style = document.createElement("style");
  style.id = id;
  style.textContent = ${JSON.stringify(result.css)};
  document.head.appendChild(style);
})();
export default ${JSON.stringify(result.css)};`
      return { contents: injected, loader: 'js' }
    })
  },
}

const workerPattern = /new Worker\(\s*new URL\(\s*(["'])([^"']+\.ts)\1\s*,\s*import\.meta\.url\s*\)\s*,/g
const workerBundles = new Map()
const browserAssetsPlugin = {
  name: 'openreel-browser-assets',
  setup(build) {
    build.onLoad({ filter: /\.tsx?$/ }, ({ path }) => {
      if (!insideVendor(path)) return undefined
      const source = readFileSync(path, 'utf8')
      const imports = []
      const contents = source.replace(workerPattern, (_full, _quote, worker) => {
        const name = `createOpenReelWorker${imports.length}`
        imports.push(`import ${name} from ${JSON.stringify(`${worker}?clip-worker`)};`)
        return `${name}(`
      })
      if (imports.length === 0) return undefined
      return { contents: `${imports.join('\n')}\n${contents}`, loader: path.endsWith('.tsx') ? 'tsx' : 'ts' }
    })
    build.onResolve({ filter: /\?(worker&url|clip-worker)$/ }, ({ path, resolveDir }) => {
      const [moduleId, query] = path.split('?')
      const local = moduleId.startsWith('.')
      const filename = local
        ? resolveVendorFile(resolveDir, moduleId.replace(/\.ts$/, ''))
        : resolvePackage(moduleId)
      if (!filename || (local && !insideVendor(filename))) {
        return { errors: [{ text: `Cannot resolve worker ${moduleId}` }] }
      }
      // esbuild writes virtual module IDs into the client bundle.
      const workerId = local ? relative(openreel, filename).split(sep).join('/') : moduleId
      return { path: workerId, namespace: query, pluginData: filename }
    })
    for (const namespace of ['worker&url', 'clip-worker']) {
      build.onLoad({ filter: /.*/, namespace }, async ({ pluginData: filename }) => {
        let compiling = workerBundles.get(filename)
        if (!compiling) {
          compiling = esbuild.build({
            absWorkingDir: root,
            entryPoints: [filename],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            minify: true,
            write: false,
            metafile: Boolean(metafileOutput),
            logLevel: 'warning',
            legalComments: 'none',
            define,
            loader: assetLoaders,
            plugins: [openreelAliasPlugin, browserAssetsPlugin],
          })
          workerBundles.set(filename, compiling)
        }
        const { outputFiles: [worker] } = await compiling
        const createURL = `URL.createObjectURL(new Blob([${JSON.stringify(worker.text)}], { type: 'text/javascript' }))`
        const contents = namespace === 'worker&url'
          ? `export default ${createURL}`
          : `export default (options) => {
              const url = ${createURL};
              try { return new Worker(url, options); }
              finally { URL.revokeObjectURL(url); }
            }`
        return { contents, loader: 'js' }
      })
    }
    build.onResolve({ filter: /\.wasm\?url$/ }, ({ path }) => ({
      path: resolvePackage(path.slice(0, -4)),
    }))
  },
}

function resolveVendorFile(base, rest) {
  const candidates = rest
    ? [
        join(base, `${rest}.ts`),
        join(base, `${rest}.tsx`),
        join(base, `${rest}.js`),
        join(base, rest, 'index.ts'),
        join(base, rest, 'index.tsx'),
        join(base, rest, 'index.js'),
        join(base, rest),
      ]
    : [
        join(base, 'index.ts'),
        join(base, 'index.tsx'),
        join(base, 'index.js'),
      ]
  return candidates.find((file) => existsSync(file))
}

const openreelAliasPlugin = {
  name: 'openreel-alias',
  setup(build) {
    const packages = {
      '@openreel/core': join(openreel, 'core'),
      '@openreel/ui': join(openreel, 'ui'),
      '@openreel/agent': join(openreel, 'agent'),
      '@openreel/creation-schema': join(openreel, 'creation-schema'),
    }
    build.onResolve({ filter: /^@openreel\// }, (args) => {
      const [scope, name, ...segments] = args.path.split('/')
      const directory = packages[`${scope}/${name}`]
      const file = directory && resolveVendorFile(directory, segments.join('/'))
      if (!file) return { errors: [{ text: `Cannot resolve ${args.path}` }] }
      return { path: file }
    })
    build.onResolve({ filter: /^@\// }, (args) => {
      const rest = args.path.slice(2)
      const file = resolveVendorFile(join(openreel, 'web'), rest)
      if (!file) return { errors: [{ text: `cannot resolve ${args.path}` }] }
      return { path: file }
    })
  },
}

const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['src/client/index.js'],
  // OpenReel reports save receipts without upload identity. Capture the request
  // in this bundle's fetch binding and leave the shared window fetch untouched.
  inject: [join(root, 'src/client/export-canvas-mode.js')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  write: false,
  metafile: Boolean(metafileOutput),
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: 'none',
  logLevel: 'info',
  sourcemap: false,
  loader: {
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.js': 'jsx',
    '.jsx': 'jsx',
    '.png': 'dataurl',
    '.jpg': 'dataurl',
    '.jpeg': 'dataurl',
    '.gif': 'dataurl',
    '.svg': 'dataurl',
    '.webp': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.css': 'js',
    ...assetLoaders,
  },
  define,
  external: [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@ffmpeg/core',
    '@ffmpeg/core-mt',
    'posthog-js',
    'posthog-js/react',
    'node:fs',
    'node:path',
    'node:url',
  ],
  plugins: [
    openreelAliasPlugin,
    tailwindPlugin,
    browserAssetsPlugin,
    stubPlugin(/^posthog-js/, 'export default { init() {}, capture() {}, identify() {} }; export const usePostHog = () => ({ capture() {} });'),
  ],
  nodePaths: [
    join(root, 'node_modules'),
    join(root, '../../node_modules'),
  ],
})

const code = result.outputFiles[0]?.text
if (!code) throw new Error('esbuild produced no output')

const wrapped = `window.__ModuleLoader__.load({
  id: "omnimux-clip",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${code}
    return module.exports;
  }
});
`

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, wrapped)
if (metafileOutput) {
  const workers = await Promise.all([...workerBundles].map(async ([path, build]) => {
    const { metafile } = await build
    return [relative(root, path).split(sep).join('/'), metafile]
  }))
  writeFileSync(metafileOutput, `${JSON.stringify({ client: result.metafile, workers: Object.fromEntries(workers.sort()), bytes: Buffer.byteLength(wrapped) }, null, 2)}\n`)
}
console.log(`wrote ${outFile} (${Buffer.byteLength(wrapped)} bytes)`)
