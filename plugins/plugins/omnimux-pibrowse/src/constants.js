export const PLUGIN_ID = 'omnimux-pibrowse'
export const ROUTE_PREFIX = '/omnimux/pibrowse'
export const MCP_SERVER_NAME = 'pibrowse'
export const SHARED_BUNDLE_PREFIX = 'fury:ork1:'
export const SEAL_INFO = 'fury-seal-v1'
export const HKDF_DOMAIN_PROFILE = 'fury-profile-v1'
export const HKDF_DOMAIN_OSCRYPT = 'fury-oscrypt-v1'
export const HKDF_DOMAIN_FINGERPRINT = 'fury-oscrypt-id-v1'
export const VERIFY_CODE_PREFIX = 'fury verify code v1\0'

export const PINNED_UPSTREAM = Object.freeze({
  repo: 'https://github.com/aronhy/pibrowse',
  upstreamBase: 'https://github.com/furyteamtop/fury-antidetect-browser',
  license: 'AGPL-3.0-or-later',
  releaseTag: 'v0.5.5',
  version: '0.5.5',
  sourceCommit: 'c72bc3654e7c70d6d5b654c30ee105e99cd60cba',
  chromiumVersion: '157.0.8103.39',
  supportedPrebuiltTargets: Object.freeze(['darwin-arm64']),
  assets: Object.freeze({
    'darwin-arm64': Object.freeze({
      dmg: Object.freeze({
        filename: 'pibrowse-0.5.5-macos-arm64.dmg',
        url: 'https://github.com/aronhy/pibrowse/releases/download/v0.5.5/pibrowse-0.5.5-macos-arm64.dmg',
        sizeBytes: 12690152,
        sha256: '33cbc6dd190b47dfca5ff2c3f0dc4c62735c21dd78f8d4005b85efe24f8c1183',
        appRelativeAgentPath: 'PiBrowse.app/Contents/MacOS/fury-agent',
      }),
      core: Object.freeze({
        filename: 'pibrowse-core-0.5.5-macos-arm64.tar.xz',
        url: 'https://github.com/aronhy/pibrowse/releases/download/v0.5.5/pibrowse-core-0.5.5-macos-arm64.tar.xz',
        sizeBytes: 119633052,
        sha256: 'a2fedc58e4b8b63ffec8a517aadf59ba7abc13526baf7a49c53b0f29d817a80a',
      }),
    }),
  }),
})

export const PIBROWSE_TOOL_NAMES = Object.freeze([
  'pibrowse_runtime_status',
  'pibrowse_manage_runtime',
  'pibrowse_manage_profiles',
  'pibrowse_check_proxy',
  'pibrowse_delete_proxy',
  'pibrowse_manage_blocklists',
  'pibrowse_manage_extensions_and_mirror',
  'pibrowse_team_sync',
])

export const UPSTREAM_MCP_TOOL_NAMES = Object.freeze([
  'fury_status',
  'fury_list_profiles',
  'fury_list_proxies',
  'fury_list_personas',
  'fury_create_profiles',
  'fury_update_profile',
  'fury_add_proxies',
  'fury_move_to_trash',
  'fury_start_profile',
  'fury_stop_profile',
  'fury_open_url',
  'fury_read_page',
  'fury_click',
  'fury_type',
  'fury_screenshot',
  'fury_warm_up',
  'fury_warm_status',
  'fury_farm_plan',
  'fury_farm_status',
])

export const ARGON2_PARAMS = Object.freeze({
  memoryKiB: 262144,
  iterations: 3,
  parallelism: 1,
  dkLen: 32,
})
