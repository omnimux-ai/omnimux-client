import { fileURLToPath } from 'node:url'

// Replace the styled components only. Package subpaths run their real code.
export const uiKitShimPlugin = {
  name: 'ui-kit-shim',
  setup(build) {
    const path = fileURLToPath(new URL('./ui-kit-shim.mjs', import.meta.url))
    build.onResolve({ filter: /^dsh-ui-kit$/ }, () => ({ path }))
  },
}
