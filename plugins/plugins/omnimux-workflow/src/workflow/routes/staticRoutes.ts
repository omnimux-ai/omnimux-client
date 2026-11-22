/** Island bundles, capability catalog and manifest. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileIdentity, SharedFileWork, statIfPresent, withRegularFile } from '../../projects/asyncFiles.ts';
import { LEGACY_WORKFLOW_ROUTE_PREFIX, WORKFLOW_ROUTE_PREFIX } from '../../shared/api.ts';
import type { GenerationGateway } from '../seam/gateway';
import type { RouteTry } from './dispatch';

const BUILD_ARTIFACTS: Record<string, string> = {
  [`${WORKFLOW_ROUTE_PREFIX}/canvas.js`]: 'canvas.js',
  [`${LEGACY_WORKFLOW_ROUTE_PREFIX}/canvas.js`]: 'canvas.js',
  [`${WORKFLOW_ROUTE_PREFIX}/director.js`]: 'director.js',
  [`${LEGACY_WORKFLOW_ROUTE_PREFIX}/director.js`]: 'director.js',
};

export interface BundleArtifact {
  version: string;
  bytes: Buffer;
}

export function createStaticRoutes({ pluginRoot, gateway }: { pluginRoot: string; gateway: GenerationGateway }) {
  const capabilitiesPath = `${WORKFLOW_ROUTE_PREFIX}/api/capabilities`;
  const manifestPath = `${WORKFLOW_ROUTE_PREFIX}/api/manifest`;
  const artifacts = new Map<string, { stamp: string; artifact: BundleArtifact }>();
  const artifactReads = new SharedFileWork<BundleArtifact | null>();

  async function readArtifact(name: string, signal?: AbortSignal): Promise<BundleArtifact | null> {
    signal?.throwIfAborted();
    const file = join(pluginRoot, 'lib', name);
    const info = await statIfPresent(file, signal);
    signal?.throwIfAborted();
    if (!info?.isFile()) return null;
    const stamp = fileIdentity(info);
    const cached = artifacts.get(file);
    if (cached && info.ino && cached.stamp === stamp) return cached.artifact;
    return artifactReads.run(`${file}\0${stamp}`, signal, async (readSignal) => {
      return withRegularFile(file, readSignal, async (handle, opened) => {
        // A Dev rebuild can replace the artifact while a request is reading.
        if (fileIdentity(opened) !== stamp) return null;
        const bytes = await handle.readFile({ signal: readSignal });
        if (fileIdentity(await handle.stat({ bigint: true })) !== stamp) return null;
        readSignal.throwIfAborted();
        const artifact = { bytes, version: createHash('sha256').update(bytes).digest('hex').slice(0, 16) };
        artifacts.set(file, { stamp, artifact });
        return artifact;
      });
    });
  }

  const tryBundle: RouteTry = async (method, path, req) => {
    if (method !== 'GET') return null;
    const artifact = BUILD_ARTIFACTS[path];
    if (artifact) {
      const file = join(pluginRoot, 'lib', artifact);
      if (!(await statIfPresent(file, req.signal))?.isFile()) {
        if (artifact === 'canvas.js') {
          return { status: 404, body: { error: 'not-found', message: 'canvas bundle not built (run npm run build)' } };
        }
        return { status: 404, body: { error: 'director-not-built' } };
      }
      return { status: 200, file };
    }
    const assetName = path.startsWith(`${WORKFLOW_ROUTE_PREFIX}/director-assets/`)
      ? path.slice(`${WORKFLOW_ROUTE_PREFIX}/director-assets/`.length) : '';
    const directorAssets = ['quaternius-standard-male.glb', 'quaternius-standard-female.glb', 'quaternius-standard-male.LICENSE.md', 'quaternius-standard-female.LICENSE.md'];
    if (directorAssets.includes(assetName)) {
      const file = join(pluginRoot, 'assets', 'director', 'models', assetName);
      if (!(await statIfPresent(file, req.signal))?.isFile()) return { status: 404, body: { error: 'director-asset-not-found' } };
      return { status: 200, file };
    }
    if (path.startsWith(`${WORKFLOW_ROUTE_PREFIX}/director-assets/licenses/`)) {
      const licenseName = path.slice(`${WORKFLOW_ROUTE_PREFIX}/director-assets/licenses/`.length);
      const licenses = new Set(['fix-webm-duration-MIT.txt', 'react-three-fiber-MIT.txt', 'cc0-1.0-legalcode.txt']);
      if (!licenses.has(licenseName)) return { status: 404, body: { error: 'director-asset-not-found' } };
      const file = join(pluginRoot, 'assets', 'director', 'licenses', licenseName);
      if (!(await statIfPresent(file, req.signal))?.isFile()) return { status: 404, body: { error: 'director-asset-not-found' } };
      return { status: 200, file };
    }
    if (path === manifestPath) {
      const [canvas, director] = await Promise.all([
        readArtifact('canvas.js', req.signal), readArtifact('director.js', req.signal),
      ]);
      return { status: 200, body: { canvasHash: canvas?.version ?? 'missing', directorHash: director?.version ?? null, directorAbi: 1 } };
    }
    return null;
  };

  /** The ETag and all encodings are derived from this immutable byte snapshot. */
  async function versionedBundle(path: string, requested: string | null, signal?: AbortSignal): Promise<BundleArtifact | null> {
    const name = BUILD_ARTIFACTS[path];
    if (!name || !requested) return null;
    const artifact = await readArtifact(name, signal);
    return artifact?.version === requested ? artifact : null;
  }

  const tryCapabilities: RouteTry = async (method, path) => {
    if (method === 'GET' && path === capabilitiesPath) {
      return { status: 200, body: await gateway.capabilities() };
    }
    return null;
  };

  return { tryBundle, tryCapabilities, versionedBundle };
}
