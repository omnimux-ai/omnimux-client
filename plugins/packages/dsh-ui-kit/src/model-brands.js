/**
 * Canonical Model Brand Registry, Validators, and 4-Tier Visual Resolver.
 *
 * Single source of truth for client-side brand identity & vector assets across
 * Hub (`omnimux`), Workflow (`omnimux-workflow`), and Browser Extension
 * (`omnimux-browser`). Zero external runtime dependencies so Node.js, React 18,
 * React 19, and browser extension bundles all import the exact same module.
 *
 * Hybrid contract (aligned with omnimux-gateway/modelcontracts/brands.go):
 * - Gateway owns canonical `brand_id`, `brand_name`, and optional monochrome
 *   24x24 SVG `<path d>` fallback (`brands[id].icon_path`).
 * - Client owns high-craft vector marks (`color` and `mono` variants) keyed by
 *   canonical `brand_id` and renders pure structured SVG elements (no HTML
 *   injection / `dangerouslySetInnerHTML`).
 */

/** Maximum UTF-8 byte length for a gateway-supplied fallback SVG `<path d>`. */
export const MAX_BRAND_ICON_PATH_BYTES = 4096

/** Canonical gateway `brand_id` slug pattern (lowercase kebab-case, <= 64 bytes). */
export const BRAND_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Strict ASCII SVG `<path d>` character whitelist (parity with gateway ValidateBrandIconPath). */
export const BRAND_ICON_PATH_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9., \t\r\n+-]+$/

/**
 * Fail-closed validator for canonical gateway `brand_id` values.
 * Rejects empty values, uppercase letters, whitespace, underscores, or > 64 bytes.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidBrandId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false
  return BRAND_ID_PATTERN.test(value)
}

/**
 * Fail-closed validator for gateway-supplied 24x24 monochrome SVG `<path d>` data.
 * Rejects raw `<svg>` markup, attributes, URLs, scripts, oversize payloads,
 * leading/trailing whitespace, or paths not beginning with `M`/`m`.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function sanitizeBrandIconPath(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.length > MAX_BRAND_ICON_PATH_BYTES) return null
  if (value.trim() !== value) return null
  const first = value[0]
  if (first !== 'M' && first !== 'm') return null
  if (!BRAND_ICON_PATH_PATTERN.test(value)) return null
  return value
}

/**
 * Canonical brand display names (parity with omnimux-gateway/modelcontracts/brands.go).
 */
export const CANONICAL_BRAND_NAMES = Object.freeze({
  alibaba: 'Alibaba',
  anthropic: 'Anthropic',
  bilibili: 'Bilibili',
  bytedance: 'ByteDance',
  deepseek: 'DeepSeek',
  elevenlabs: 'ElevenLabs',
  google: 'Google',
  grok: 'xAI',
  indextts: 'Index TTS2',
  instagram: 'Instagram',
  kimi: 'Kimi',
  kling: 'Kling',
  midjourney: 'Midjourney',
  minimax: 'MiniMax',
  muse: 'Muse',
  openai: 'OpenAI',
  runway: 'Runway',
  stability: 'Stability AI',
  suno: 'Suno',
  tiktok: 'TikTok',
  'typesafe-ai': 'TypeSafe AI',
  veo: 'Veo',
  vidu: 'Vidu',
  x: 'X',
  youtube: 'YouTube',
  zhipu: 'Zhipu',
})

/**
 * Historical / product-family alias map -> canonical gateway brand_id.
 */
export const BRAND_ID_ALIASES = Object.freeze({
  xai: 'grok',
  seedream: 'bytedance',
  seedance: 'bytedance',
  dreamina: 'bytedance',
  doubao: 'bytedance',
  volcengine: 'bytedance',
  nanobanana: 'google',
  'nano-banana': 'google',
  gemini: 'google',
  claude: 'anthropic',
  wan: 'alibaba',
  qwen: 'alibaba',
  happyhorse: 'alibaba',
  hailuo: 'minimax',
  mj: 'midjourney',
  gxgenai: 'indextts',
  'index-tts': 'indextts',
  'indextts-2': 'indextts',
  glm: 'zhipu',
  moonshot: 'kimi',
})

const OPENAI_PATH = 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.0993 3.8558L12.6 8.3829l2.02-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.1408 1.6465 4.4708 4.4708 0 0 1 .5765 3.0137zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997z'

const ANTHROPIC_PATH = 'M17.304 3.541h-3.672l6.696 16.918h3.672l-6.696-16.918zm-10.608 0l-6.696 16.918h3.78l1.344-3.528h6.468l1.344 3.528h3.78l-6.696-16.918h-3.324zm-.372 10.362l2.172-5.676 2.172 5.676h-4.344z'

const GOOGLE_PATHS = [
  { d: 'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z', color: '#4285F4' },
  { d: 'M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z', color: '#34A853' },
  { d: 'M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z', color: '#FBBC05' },
  { d: 'M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z', color: '#EA4335' },
]

const VEO_PATH = 'M8.99805 2.38477C9.53893 3.90621 10.4105 5.29349 11.5566 6.44238L11.5586 6.44336C12.5481 7.43013 13.7171 8.21841 15.0029 8.76562C15.2029 8.8518 15.4064 8.9289 15.6113 9.00195C14.0914 9.54303 12.7055 10.4153 11.5576 11.5605L11.5566 11.5615C10.412 12.7102 9.5406 14.0963 8.99902 15.6162C8.45764 14.0958 7.58633 12.7095 6.44043 11.5615L6.43945 11.5605L6.17578 11.3066C5.08059 10.2858 3.78911 9.50275 2.38281 9.00195C3.90333 8.45997 5.29032 7.58857 6.43945 6.44336L6.44043 6.44238C7.58587 5.29322 8.45678 3.90579 8.99805 2.38477Z'

const KLING_PATH = 'M10.7246 1.68961C13.6779 1.39563 16.7164 2.23209 18.9405 4.27831C21.5718 6.69902 19.8346 9.81153 18.5014 12.4294L22.3499 16.5265C19.4865 23.1738 10.5256 25.7602 5.05933 20.731C2.42803 18.3103 4.16516 15.1977 5.49845 12.5799L1.6499 8.48276C3.147 4.93161 6.95004 2.06526 10.7246 1.68961ZM16.7767 3.99016C11.8861 1.12614 5.4609 3.33336 2.91607 8.34627L6.25496 11.8029C8.49606 8.80475 11.2457 6.20905 14.6528 4.66796L16.7767 3.99016ZM17.8017 11.6886C18.8165 10.4158 20.0508 7.20183 19.102 5.74707C17.7721 3.70784 14.2114 5.50792 12.6813 6.4972C13.9179 6.45287 14.9372 6.34204 16.06 7.00001C16.6823 7.36399 17.8017 8.69042 17.8017 9.41371V11.6886ZM13.4549 7.17266C9.96016 7.47015 6.02402 11.8648 6.93298 15.5419C7.95 19.6507 13.2183 17.4645 15.1875 15.2491C17.6436 12.4866 18.4479 6.74802 13.4538 7.17266H13.4549ZM6.19808 15.5967C6.10593 15.0333 6.19808 14.0101 6.19808 13.3802C6.19808 13.3347 6.59624 12.9054 6.14347 13.2064C5.22883 14.7253 3.65324 18.1889 5.22883 19.6239C6.80443 21.0588 9.81682 19.4337 11.3196 18.5121C10.2116 18.4841 9.14108 18.6486 8.09675 18.0828C7.35958 17.6838 6.338 16.4449 6.19922 15.5956L6.19808 15.5967ZM19.3546 19.114C19.6447 18.8166 21.1406 16.9628 21.0837 16.6642L17.7448 13.2075C15.5754 16.131 12.8622 18.6871 9.57451 20.2258L7.22307 21.0203C11.2252 23.2823 16.1636 22.3875 19.3546 19.114Z'

const ALIBABA_PATH = 'M10.3746 20.1092L5.16567 20.1062C5.04656 20.1039 4.94147 20.0419 4.85439 19.9666L3.4196 17.4835C3.34553 17.3048 3.33903 17.2085 3.41084 17.0267C3.72813 16.3438 4.29864 15.6458 4.59266 14.9689C4.61142 14.9256 4.6427 14.888 4.62468 14.8358L2.04987 10.351C1.95954 10.1332 2.00132 10.0117 2.10016 9.81354C2.50302 9.0051 3.06378 8.21279 3.49091 7.41191C3.588 7.3194 3.70561 7.26697 3.84098 7.26092L6.30019 7.25764L8.95533 2.64194C9.04466 2.57237 9.12649 2.53632 9.24034 2.52598C10.1537 2.4438 11.1886 2.58825 12.1144 2.5285C12.239 2.56455 12.3501 2.63766 12.4245 2.74505L13.6708 4.88929L18.8415 4.89307C18.9691 4.90189 19.0967 4.95786 19.1773 5.05844C19.5929 5.85554 20.1662 6.64381 20.557 7.44595C20.6321 7.59997 20.6796 7.68543 20.6416 7.86718L19.3815 10.1385L21.9971 14.7338L22.0006 14.9778C21.598 15.7376 21.1793 16.5127 20.7322 17.2508C20.5875 17.4896 20.5097 17.7099 20.1914 17.7386C19.4285 17.8074 18.5632 17.6864 17.789 17.7361L17.7157 17.7631L15.0668 22.3473C14.9838 22.4277 14.9062 22.4622 14.7918 22.473C13.8893 22.5585 12.8563 22.406 11.9398 22.4733C11.8124 22.4637 11.6805 22.3863 11.608 22.2787L10.3746 20.109V20.1092ZM9.27862 7.76509L10.6266 5.38514L9.30339 3.03066L6.73458 7.50468L8.22017 10.1032L8.89002 10.1334L18.7864 10.1284L20.1527 7.76509H9.27862ZM6.57894 7.76509H3.87926L9.27862 17.2591H6.55392L5.22898 19.601C5.57454 19.6073 5.9216 19.5937 6.26741 19.6003C6.33297 19.6015 6.39378 19.6265 6.46509 19.6277C7.7565 19.6474 9.05242 19.6252 10.3416 19.6033L10.3806 19.5851L11.8482 17.0161L6.57894 7.76509ZM18.8152 14.8669H21.5024L18.9486 10.3883L15.9524 10.3964L10.6631 19.6013L12.0278 21.9684L17.428 12.4995L18.815 14.8666L18.8152 14.8669Z'

const BYTEDANCE_PATHS = [
  'M22.0004 4.62844L18.542 3.75781V21.2425L22.0004 20.3278V4.62844Z',
  'M1.99902 20.1939L5.42937 19.3073L5.44542 5.56984L1.99902 4.69922V20.1939Z',
  'M16.1213 9.26561C15.2507 9.43412 14.2998 9.75509 13.4252 9.97174C13.3048 10.0038 13.0962 9.93563 13.0521 10.068L13.04 17.5947L16.4985 18.4613V9.27765C16.4985 9.17735 16.1895 9.25358 16.1213 9.26561Z',
  'M7.49609 11.582V20.7336L7.60041 20.7657L10.9264 19.9312L10.9465 12.3925L7.80904 11.6583L7.49609 11.582Z',
]

const DEEPSEEK_PATH = 'M23.75 4.927c-.245-.12-.34.108-.482.224c-.049.038-.09.087-.131.13c-.357.384-.773.634-1.315.604c-.796-.044-1.474.207-2.074.818c-.127-.754-.551-1.203-1.195-1.492c-.338-.15-.68-.3-.915-.626c-.165-.231-.21-.49-.293-.744c-.052-.153-.105-.31-.28-.337c-.192-.03-.266.13-.341.265c-.3.55-.416 1.158-.406 1.772c.027 1.382.608 2.482 1.762 3.266c.132.09.166.18.124.311c-.079.27-.172.531-.255.8c-.052.173-.13.211-.314.135A5.3 5.3 0 0 1 15.97 8.92c-.82-.797-1.563-1.677-2.489-2.366a11 11 0 0 0-.66-.454c-.944-.922.125-1.679.372-1.768c.259-.093.09-.416-.747-.412c-.835.004-1.6.285-2.574.659c-.143.057-.326.153-.446.13a9.2 9.2 0 0 0-2.763-.096c-1.806.203-3.25 1.06-4.31 2.525c-1.275 1.76-1.574 3.759-1.207 5.846c.385 2.197 1.502 4.019 3.22 5.442c1.78 1.474 3.83 2.197 6.169 2.058c1.42-.081 3.003-.273 4.786-1.789c.45.224.922.313 1.707.381c.603.057 1.184-.03 1.634-.123c.704-.15.655-.804.4-.926c-2.065-.966-1.612-.573-2.024-.89c1.05-1.248 2.632-2.544 3.25-6.741c.049-.334.007-.543 0-.814c-.003-.163.034-.228.22-.247a4 4 0 0 0 1.482-.457c1.338-.734 1.867-1.939 1.995-3.385c.019-.22-.004-.45-.236-.565m-11.652 13.01c-2.002-1.58-2.972-2.1-3.373-2.078c-.375.021-.308.452-.225.733c.086.277.198.468.356.711c.109.162.184.402-.108.58c-.645.403-1.766-.134-1.82-.16c-1.303-.77-2.394-1.79-3.163-3.182c-.741-1.342-1.172-2.78-1.243-4.315c-.02-.372.09-.503.456-.57a4.5 4.5 0 0 1 1.466-.037c2.043.3 3.782 1.218 5.24 2.67c.832.829 1.462 1.817 2.11 2.783c.69 1.027 1.432 2.004 2.377 2.804c.333.281.6.495.854.653c-.768.085-2.05.104-2.927-.592'

const MIDJOURNEY_PATH = 'M22.1503 20.9512C21.2695 20.5085 20.9352 19.5915 19.6703 19.8084C18.6449 19.9845 17.8001 21.8276 16.6527 20.8157C18.1208 20.0162 19.9413 19.1533 21.1656 17.9969C21.3101 17.8614 21.8341 17.4277 21.4592 17.256C21.1701 17.125 19.8013 17.3464 19.3767 17.369C13.7842 17.6762 8.16907 18.0285 2.5856 18.4622C2.12483 18.67 3.09606 19.7496 3.05541 19.9123L1 21.3036V21.6605H1.44722C2.08869 21.5069 3.41228 20.0749 3.9905 20.1381C4.22992 20.1607 5.01143 20.9964 5.35475 21.1952C5.72066 21.412 6.07301 21.4978 6.45247 21.6605H6.89969C7.76251 21.525 8.52143 20.2872 9.35714 20.3143C10.1974 20.3414 10.8479 21.5204 11.7288 21.6605H12.2663C13.1472 21.5204 13.7977 20.3414 14.638 20.3143C15.4737 20.2872 16.2281 21.525 17.0954 21.6605H17.633C18.4913 21.5159 19.1734 20.3414 20.0046 20.3143C20.8222 20.2872 21.5992 21.5295 22.462 21.6605H22.9996V21.3036C22.8054 21.0371 22.4756 21.1139 22.1458 20.9467L22.1503 20.9512ZM16.0925 20.3956C15.8802 20.3504 15.4646 19.9123 15.049 19.8264C13.5944 19.5238 13.0388 21.0777 12.0405 21.1229C10.9202 21.1726 10.3239 19.1895 8.57112 19.9755C7.47791 20.4679 7.27463 21.5927 5.80197 20.8428C5.02498 20.4453 4.49645 19.3024 3.51166 19.6954L3.2361 19.0268L20.4066 17.8207C19.9549 18.286 19.3405 18.6745 18.7894 19.0178C18.4145 19.2527 16.3546 20.4498 16.0925 20.3956Z'

const GROK_PATH = 'M4.94 4.96a9.97 9.97 0 0 1 10.835-2.182a8.7 8.7 0 0 1 2.033 1.11l-3.006 1.39C12.003 4.101 8.797 4.9 6.84 6.86c-2.564 2.565-3.146 6.954-.36 9.922l.278.284L.124 23c1.875-1.973 3.771-4.427 2.636-7.19c-1.52-3.698-.635-8.03 2.18-10.85M23.9.1c-2.264 3.174-3.184 5.389-2.197 9.64l-.007-.007c.753 3.201-.052 6.75-2.653 9.355c-3.279 3.285-8.526 4.016-12.847 1.06L9.21 18.75c2.758 1.084 5.775.607 7.943-1.564c2.169-2.17 2.655-5.332 1.566-7.963c-.207-.5-.828-.625-1.263-.304L8.59 15.472l12.7-12.77v.01z'

const VIDU_PATH = 'M2.23986 7.09139C4.18634 5.25751 7.43179 5.75665 8.71506 8.01943C9.56273 9.51315 10.0219 11.4469 10.7636 13.0071C10.587 14.0794 10.0847 15.0666 9.55095 16.0131C9.4293 16.1092 9.2841 15.7025 9.24878 15.6323C8.32655 13.6357 7.65941 11.3766 6.68616 9.41702C5.77571 7.59053 3.51135 8.30412 3.48781 10.0197C3.48388 10.2896 3.6644 10.7037 3.75859 10.9699C4.33547 12.6004 5.21453 15.0333 5.99548 16.5418C6.61553 17.7397 7.74967 18.6308 9.23308 18.1575C10.5046 17.7508 11.2306 16.3421 11.6583 15.2403C12.7101 12.5154 13.3419 9.38005 14.4643 6.71796C16.4264 2.0704 24.44 4.13352 22.7721 9.65735C22.1913 11.58 21.4104 13.6209 20.7119 15.5213C20.2919 16.6712 20.029 17.6214 19.2402 18.6382C17.9059 20.3612 15.41 21.511 13.2595 20.424C14.0561 19.7955 14.5349 18.9081 14.9705 18.0392C15.308 17.9616 15.6023 17.9727 15.9516 17.8876C17.5841 17.4883 18.1767 15.366 18.6633 14.035C19.3383 12.2048 19.8799 10.3266 20.5117 8.48159C20.7864 6.44066 17.6312 5.67901 16.8228 7.60902C15.7004 10.2822 15.0843 13.388 13.9973 16.1129C12.9102 18.8378 11.2306 20.8418 7.90272 20.583C5.86205 20.424 4.43358 18.8933 3.63693 17.2443C2.84813 15.6175 1.83957 13.2401 1.26661 11.5467C0.736825 9.96423 0.964438 8.29303 2.23986 7.09139Z'

/**
 * Structured brand catalog.
 * Each brand defines metadata and structured SVG descriptors (`color` & `mono`)
 * so React components render native SVG nodes without `dangerouslySetInnerHTML`.
 */
export const BRAND_CATALOG = Object.freeze({
  openai: Object.freeze({
    id: 'openai',
    name: 'OpenAI',
    company: 'OpenAI',
    series: Object.freeze({ zh: 'Sora / GPT', en: 'Sora / GPT' }),
    primaryColor: '#10A37F',
    models: Object.freeze(['gpt-5.5', 'gpt-4o', 'gpt-image-2.5', 'sora-2', 'sora-2-standard', 'sora2', 'dall-e-3']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: OPENAI_PATH }) }]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: OPENAI_PATH }) }]),
    }),
  }),
  anthropic: Object.freeze({
    id: 'anthropic',
    name: 'Anthropic',
    company: 'Anthropic',
    series: Object.freeze({ zh: 'Claude', en: 'Claude' }),
    primaryColor: '#D97706',
    models: Object.freeze(['claude-opus-4-6', 'claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-haiku']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: ANTHROPIC_PATH }) }]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: ANTHROPIC_PATH }) }]),
    }),
  }),
  google: Object.freeze({
    id: 'google',
    name: 'Google',
    company: 'Google',
    series: Object.freeze({ zh: 'Gemini', en: 'Gemini' }),
    primaryColor: '#4285F4',
    models: Object.freeze(['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3-pro', 'nano-banana-2', 'nano-banana-pro', 'nanobanana-2', 'nanobanana-pro']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze(GOOGLE_PATHS.map((p) => Object.freeze({ tag: 'path', attrs: Object.freeze({ d: p.d, fill: p.color }) }))),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze(GOOGLE_PATHS.map((p) => Object.freeze({ tag: 'path', attrs: Object.freeze({ d: p.d, fill: 'currentColor' }) }))),
    }),
  }),
  veo: Object.freeze({
    id: 'veo',
    name: 'Veo',
    company: 'Google DeepMind',
    series: Object.freeze({ zh: 'Veo', en: 'Veo' }),
    primaryColor: '#1A73E8',
    models: Object.freeze(['veo31', 'veo3.1', 'veo-3', 'veo3', 'omni-flash']),
    color: Object.freeze({
      viewBox: '0 0 18 18',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: VEO_PATH, stroke: 'currentColor', strokeWidth: 1.33 }) }]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 18 18',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: VEO_PATH, stroke: 'currentColor', strokeWidth: 1.33 }) }]),
    }),
  }),
  kling: Object.freeze({
    id: 'kling',
    name: 'Kling',
    company: '快手',
    series: Object.freeze({ zh: '可灵', en: 'Kling' }),
    primaryColor: '#FF5000',
    models: Object.freeze(['kling-o3', 'kling-v3-motion-control', 'kling-motion-control', 'kling-video-o1', 'kling-1-5', 'kling30']),
    color: Object.freeze({
      viewBox: '0 0 24 25',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: KLING_PATH, fill: 'currentColor' }) }]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 25',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: KLING_PATH, fill: 'currentColor' }) }]),
    }),
  }),
  alibaba: Object.freeze({
    id: 'alibaba',
    name: 'Alibaba',
    company: '阿里',
    series: Object.freeze({ zh: '万相 / 通义', en: 'Wan / Qwen' }),
    primaryColor: '#6366F1',
    models: Object.freeze(['wan-3.0', 'wan3.0', 'wan30', 'wan-2.7', 'wan2.7', 'wan-2.6', 'wan2.6', 'wan26', 'wanxiang-v2-6', 'happyhorse-1', 'happyhorse-1.0', 'qwen-max', 'qwen-vl']),
    color: Object.freeze({
      viewBox: '0 0 24 25',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: ALIBABA_PATH, fill: 'currentColor' }) }]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 25',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: ALIBABA_PATH, fill: 'currentColor' }) }]),
    }),
  }),
  bytedance: Object.freeze({
    id: 'bytedance',
    name: 'ByteDance',
    company: '字节跳动',
    series: Object.freeze({ zh: '即梦 / 豆包', en: 'Seedance / Seedream' }),
    primaryColor: '#3B82F6',
    models: Object.freeze(['seedream-5-0-pro', 'seedance-2-0-fast', 'seedance-2', 'doubao-seedance-pro', 'seedream']),
    color: Object.freeze({
      viewBox: '0 0 24 25',
      fill: 'none',
      elements: Object.freeze(BYTEDANCE_PATHS.map((d) => Object.freeze({ tag: 'path', attrs: Object.freeze({ d, fill: 'currentColor' }) }))),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 25',
      fill: 'none',
      elements: Object.freeze(BYTEDANCE_PATHS.map((d) => Object.freeze({ tag: 'path', attrs: Object.freeze({ d, fill: 'currentColor' }) }))),
    }),
  }),
  deepseek: Object.freeze({
    id: 'deepseek',
    name: 'DeepSeek',
    company: 'DeepSeek',
    series: Object.freeze({ zh: '深度求索', en: 'DeepSeek' }),
    primaryColor: '#0284C7',
    models: Object.freeze(['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: DEEPSEEK_PATH }) }]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: DEEPSEEK_PATH }) }]),
    }),
  }),
  midjourney: Object.freeze({
    id: 'midjourney',
    name: 'Midjourney',
    company: 'Midjourney',
    series: Object.freeze({ zh: 'Midjourney', en: 'Midjourney' }),
    primaryColor: '#FFFFFF',
    models: Object.freeze(['mj-v8-1', 'mj-v7', 'midjourney-video']),
    color: Object.freeze({
      viewBox: '0 0 24 25',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: MIDJOURNEY_PATH, fill: 'currentColor' }) }]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 25',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: MIDJOURNEY_PATH, fill: 'currentColor' }) }]),
    }),
  }),
  minimax: Object.freeze({
    id: 'minimax',
    name: 'MiniMax',
    company: 'MiniMax',
    series: Object.freeze({ zh: '海螺', en: 'Hailuo' }),
    primaryColor: '#10B981',
    models: Object.freeze(['minimax-h3', 'minimax-video', 'hailuo-01', 'minimax-chat']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2, y: 2, width: 20, height: 20, rx: 4, fill: '#10B981' }) }),
        Object.freeze({ tag: 'text', attrs: Object.freeze({ x: 12, y: 16, textAnchor: 'middle', fill: 'white', fontSize: 10, fontWeight: 'bold' }), text: 'M' }),
      ]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2.5, y: 2.5, width: 19, height: 19, rx: 4.5, stroke: 'currentColor', strokeWidth: 1.8 }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M7 16.5V7.5L12 12.5L17 7.5V16.5', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }) }),
      ]),
    }),
  }),
  muse: Object.freeze({
    id: 'muse',
    name: 'Muse',
    company: 'Muse',
    series: Object.freeze({ zh: 'Muse Video / Muse Image', en: 'Muse Video / Muse Image' }),
    primaryColor: '#8B5CF6',
    models: Object.freeze(['muse-video', 'muse-image']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2, y: 2, width: 20, height: 20, rx: 4, fill: '#8B5CF6' }) }),
        Object.freeze({ tag: 'text', attrs: Object.freeze({ x: 12, y: 16, textAnchor: 'middle', fill: 'white', fontSize: 10, fontWeight: 'bold' }), text: 'M' }),
      ]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2.5, y: 2.5, width: 19, height: 19, rx: 4.5, stroke: 'currentColor', strokeWidth: 1.8 }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M7.5 16.5V7.5L12 12.5L16.5 7.5V16.5', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }) }),
      ]),
    }),
  }),
  grok: Object.freeze({
    id: 'grok',
    name: 'xAI',
    company: 'xAI',
    series: Object.freeze({ zh: 'Grok', en: 'Grok' }),
    primaryColor: '#FFFFFF',
    models: Object.freeze(['grok-imagine', 'grok-imagine-video-1-5', 'grok-3', 'grok-2']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ fill: 'currentColor', d: GROK_PATH }) }]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ fill: 'currentColor', d: GROK_PATH }) }]),
    }),
  }),
  vidu: Object.freeze({
    id: 'vidu',
    name: 'Vidu',
    company: '生数科技',
    series: Object.freeze({ zh: 'Vidu', en: 'Vidu' }),
    primaryColor: '#EC4899',
    models: Object.freeze(['viduq2', 'vidu-v1', 'vidu-video']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: VIDU_PATH, fill: 'currentColor' }) }]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([{ tag: 'path', attrs: Object.freeze({ d: VIDU_PATH, fill: 'currentColor' }) }]),
    }),
  }),
  runway: Object.freeze({
    id: 'runway',
    name: 'Runway',
    company: 'Runway',
    series: Object.freeze({ zh: 'Gen', en: 'Gen' }),
    primaryColor: '#14B8A6',
    models: Object.freeze(['gen-3-alpha', 'gen-2', 'runway-video']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2, y: 6, width: 20, height: 12, rx: 2, fill: 'currentColor' }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M7 10L10 12L7 14V10Z', fill: 'white' }) }),
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 12, y: 10, width: 5, height: 1, fill: 'white' }) }),
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 12, y: 13, width: 5, height: 1, fill: 'white' }) }),
      ]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2.5, y: 6.5, width: 19, height: 11, rx: 2, stroke: 'currentColor', strokeWidth: 1.8 }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M7 10L10.5 12L7 14V10Z', fill: 'currentColor' }) }),
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 12.5, y: 10, width: 5, height: 1.3, fill: 'currentColor' }) }),
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 12.5, y: 12.8, width: 5, height: 1.3, fill: 'currentColor' }) }),
      ]),
    }),
  }),
  elevenlabs: Object.freeze({
    id: 'elevenlabs',
    name: 'ElevenLabs',
    company: 'ElevenLabs',
    series: Object.freeze({ zh: 'Voice', en: 'Voice' }),
    primaryColor: '#000000',
    models: Object.freeze(['speech-2.8-hd', 'eleven-multilingual-v2', 'eleven-turbo-v2']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2, y: 2, width: 20, height: 20, rx: 4, fill: '#000' }) }),
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 7, y: 6, width: 2, height: 12, fill: 'white' }) }),
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 11, y: 6, width: 2, height: 12, fill: 'white' }) }),
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 15, y: 6, width: 2, height: 12, fill: 'white' }) }),
      ]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 5.5, y: 5, width: 2.5, height: 14, rx: 1, fill: 'currentColor' }) }),
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 10.75, y: 5, width: 2.5, height: 14, rx: 1, fill: 'currentColor' }) }),
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 16, y: 5, width: 2.5, height: 14, rx: 1, fill: 'currentColor' }) }),
      ]),
    }),
  }),
  stability: Object.freeze({
    id: 'stability',
    name: 'Stability AI',
    company: 'Stability AI',
    series: Object.freeze({ zh: 'SD', en: 'Stable Diffusion' }),
    primaryColor: '#7C3AED',
    models: Object.freeze(['sdxl-turbo', 'sd-3.5-large', 'stable-video-diffusion']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([
        Object.freeze({ tag: 'circle', attrs: Object.freeze({ cx: 12, cy: 12, r: 10, fill: '#7C3AED' }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M12 6L18 12L12 18L6 12L12 6Z', fill: 'white' }) }),
      ]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'circle', attrs: Object.freeze({ cx: 12, cy: 12, r: 9.5, stroke: 'currentColor', strokeWidth: 1.8 }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M12 6.5L17.5 12L12 17.5L6.5 12L12 6.5Z', fill: 'currentColor' }) }),
      ]),
    }),
  }),
  suno: Object.freeze({
    id: 'suno',
    name: 'Suno',
    company: 'Suno',
    series: Object.freeze({ zh: 'Suno 音乐', en: 'Suno Music' }),
    primaryColor: '#FF3366',
    models: Object.freeze(['suno', 'suno-v3', 'suno-v3.5', 'suno-v4']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      elements: Object.freeze([
        Object.freeze({ tag: 'circle', attrs: Object.freeze({ cx: 12, cy: 12, r: 10, fill: '#FF3366' }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M12 6v8.5a2.5 2.5 0 1 1-2-2.45V8h5v4.5a2.5 2.5 0 1 1-2-2.45V6h-1z', fill: 'white' }) }),
      ]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'circle', attrs: Object.freeze({ cx: 12, cy: 12, r: 9.5, stroke: 'currentColor', strokeWidth: 1.8 }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M12 6v8.5a2.5 2.5 0 1 1-2-2.45V8h5v4.5a2.5 2.5 0 1 1-2-2.45V6h-1z', fill: 'currentColor' }) }),
      ]),
    }),
  }),
  indextts: Object.freeze({
    id: 'indextts',
    name: 'Index TTS2',
    company: 'Index TTS2',
    series: Object.freeze({ zh: 'Index TTS2', en: 'Index TTS2' }),
    primaryColor: '#9460EF',
    models: Object.freeze(['index-tts', 'indextts-2']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2, y: 2, width: 20, height: 20, rx: 4, fill: '#9460EF' }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M12 5V19M8 9V15M16 8V16M4 11V13M20 10V14', stroke: 'white', strokeWidth: 2, strokeLinecap: 'round' }) }),
      ]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M12 4.5V19.5M8 8.5V15.5M16 7.5V16.5M4 10.5V13.5M20 9.5V14.5', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }) }),
      ]),
    }),
  }),
  kimi: Object.freeze({
    id: 'kimi',
    name: 'Kimi',
    company: '月之暗面',
    series: Object.freeze({ zh: 'Kimi', en: 'Kimi' }),
    primaryColor: '#0F172A',
    models: Object.freeze(['kimi-k2', 'kimi-k2.5']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2, y: 2, width: 20, height: 20, rx: 4, fill: '#0F172A' }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M8 6.5V17.5M16 6.5L10 12L16.5 17.5', stroke: 'white', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }) }),
      ]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2.5, y: 2.5, width: 19, height: 19, rx: 4.5, stroke: 'currentColor', strokeWidth: 1.8 }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M8.5 7V17M15.5 7L10 12L16 17', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }) }),
      ]),
    }),
  }),
  zhipu: Object.freeze({
    id: 'zhipu',
    name: 'Zhipu',
    company: '智谱',
    series: Object.freeze({ zh: 'GLM', en: 'GLM' }),
    primaryColor: '#2563EB',
    models: Object.freeze(['glm-4.5', 'glm-4']),
    color: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2, y: 2, width: 20, height: 20, rx: 4, fill: '#2563EB' }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M7.5 7.5H16.5L7.5 16.5H16.5', stroke: 'white', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }) }),
      ]),
    }),
    mono: Object.freeze({
      viewBox: '0 0 24 24',
      fill: 'none',
      elements: Object.freeze([
        Object.freeze({ tag: 'rect', attrs: Object.freeze({ x: 2.5, y: 2.5, width: 19, height: 19, rx: 4.5, stroke: 'currentColor', strokeWidth: 1.8 }) }),
        Object.freeze({ tag: 'path', attrs: Object.freeze({ d: 'M8 8H16L8 16H16', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }) }),
      ]),
    }),
  }),
})

/**
 * Legacy model-ID prefix/keyword regex table (Tier 3 fallback when gateway
 * omits `brand_id`, e.g., older snapshots or custom BYOK models).
 */
export const BRAND_MATCH_RULES = Object.freeze([
  Object.freeze({ brand: 'indextts', regex: /(^index|^indextts|gxgenai)/i }),
  Object.freeze({ brand: 'suno', regex: /(^suno|\bsuno\b)/i }),
  Object.freeze({ brand: 'veo', regex: /(^veo|\bveo\b|omni[- ]?flash)/i }),
  Object.freeze({ brand: 'google', regex: /(^gemini|\bgemini\b|google|nano[-_ ]?banana|nanobanana|^imagen)/i }),
  Object.freeze({ brand: 'anthropic', regex: /(^claude|\bclaude\b|anthropic)/i }),
  Object.freeze({ brand: 'kling', regex: /(^kling|\bkling\b|可灵)/i }),
  Object.freeze({ brand: 'alibaba', regex: /(^wan|\bwan\b|wanxiang|万相|通义|qwen|happyhorse|alibaba)/i }),
  Object.freeze({ brand: 'deepseek', regex: /(^deepseek|\bdeepseek\b|深度求索)/i }),
  Object.freeze({ brand: 'bytedance', regex: /(^seed|seedance|seedream|seed[-_ ]?dream|doubao|豆包|即梦|dreamina|bytedance|volcengine)/i }),
  Object.freeze({ brand: 'openai', regex: /(^gpt|^o1\b|^o3\b|^o4\b|^o1-|^o3-|^o4-|openai|sora|dall[- ]?e|chatgpt)/i }),
  Object.freeze({ brand: 'midjourney', regex: /(^midjourney|\bmidjourney\b|\bmj\b|^mj-|niji)/i }),
  Object.freeze({ brand: 'minimax', regex: /(^minimax|\bminimax\b|hailuo|海螺)/i }),
  Object.freeze({ brand: 'muse', regex: /(^muse|\bmuse\b)/i }),
  Object.freeze({ brand: 'grok', regex: /(^grok|\bgrok\b|xai)/i }),
  Object.freeze({ brand: 'vidu', regex: /(^vidu|\bvidu\b|生数)/i }),
  Object.freeze({ brand: 'runway', regex: /(^runway|\brunway\b|^gen-[23])/i }),
  Object.freeze({ brand: 'elevenlabs', regex: /(^eleven|elevenlabs|11labs|^speech)/i }),
  Object.freeze({ brand: 'stability', regex: /(^sd[\d.-]|^sd\b|stability|stable[- ]?diffusion|sdxl)/i }),
  Object.freeze({ brand: 'kimi', regex: /(^kimi|\bkimi\b|moonshot)/i }),
  Object.freeze({ brand: 'zhipu', regex: /(^glm|\bglm\b|zhipu|智谱)/i }),
])

/** SVG attribute name map from camelCase React props to kebab-case XML attrs. */
const SVG_XML_ATTRS = Object.freeze({
  strokeWidth: 'stroke-width',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  textAnchor: 'text-anchor',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
})

function escapeXmlAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Serialize a structured BrandVector descriptor into a static SVG string
 * (for JSON APIs such as `/omnimux/api/brands` and backwards-compatible consumers).
 *
 * @param {{ viewBox: string, fill: string, elements: ReadonlyArray<{ tag: string, attrs: Record<string, string | number>, text?: string }> }} vector
 * @param {number} [size]
 * @returns {string}
 */
export function serializeBrandVector(vector, size = 24) {
  const px = Number.isFinite(size) && size > 0 ? size : 24
  const children = vector.elements.map((el) => {
    const attrs = Object.entries(el.attrs)
      .map(([key, val]) => `${SVG_XML_ATTRS[key] ?? key}="${escapeXmlAttr(val)}"`)
      .join(' ')
    if (el.text !== undefined) {
      return `<${el.tag} ${attrs}>${escapeXmlAttr(el.text)}</${el.tag}>`
    }
    return `<${el.tag} ${attrs}/>`
  }).join('')
  return `<svg width="${px}" height="${px}" viewBox="${escapeXmlAttr(vector.viewBox)}" fill="${escapeXmlAttr(vector.fill)}" xmlns="http://www.w3.org/2000/svg">${children}</svg>`
}

/** Pre-serialized color SVG map keyed by canonical brand_id. */
export const BRAND_SVGS = Object.freeze(
  Object.fromEntries(
    Object.entries(BRAND_CATALOG).map(([id, entry]) => [id, serializeBrandVector(entry.color, 24)]),
  ),
)

/** Pre-serialized monochrome (`currentColor`) SVG map keyed by canonical brand_id. */
export const BRAND_SVGS_MONO = Object.freeze(
  Object.fromEntries(
    Object.entries(BRAND_CATALOG).map(([id, entry]) => [id, serializeBrandVector(entry.mono, 24)]),
  ),
)

/**
 * Resolve a known canonical brand_id from an exact brand ID or historical alias.
 * Returns `null` if the input does not map to a local registry entry.
 *
 * @param {unknown} candidate
 * @returns {string | null}
 */
export function canonicalizeLocalBrandId(candidate) {
  if (typeof candidate !== 'string') return null
  const trimmed = candidate.trim().toLowerCase()
  if (!trimmed) return null
  if (Object.prototype.hasOwnProperty.call(BRAND_CATALOG, trimmed)) return trimmed
  if (Object.prototype.hasOwnProperty.call(BRAND_ID_ALIASES, trimmed)) {
    const target = BRAND_ID_ALIASES[trimmed]
    if (Object.prototype.hasOwnProperty.call(BRAND_CATALOG, target)) return target
  }
  return null
}

/**
 * Resolve canonical brand display name from a brand ID.
 *
 * @param {unknown} brandId
 * @returns {string | null}
 */
export function getCanonicalBrandName(brandId) {
  if (!isValidBrandId(brandId)) return null
  if (Object.prototype.hasOwnProperty.call(CANONICAL_BRAND_NAMES, brandId)) {
    return CANONICAL_BRAND_NAMES[brandId]
  }
  const canonical = canonicalizeLocalBrandId(brandId)
  if (canonical && Object.prototype.hasOwnProperty.call(BRAND_CATALOG, canonical)) {
    return BRAND_CATALOG[canonical].name
  }
  return null
}

/**
 * Resolve canonical brand ID from any model ID, family, or brand token.
 * Never invents a brand: returns `null` when unrecognized.
 *
 * @param {unknown} modelOrBrandId
 * @returns {string | null}
 */
export function resolveModelBrand(modelOrBrandId) {
  if (typeof modelOrBrandId !== 'string') return null
  const trimmed = modelOrBrandId.trim().toLowerCase()
  if (!trimmed) return null

  const direct = canonicalizeLocalBrandId(trimmed)
  if (direct) return direct

  for (const [brandId, brand] of Object.entries(BRAND_CATALOG)) {
    if (brand.models.some((m) => m.toLowerCase() === trimmed)) {
      return brandId
    }
  }

  for (const rule of BRAND_MATCH_RULES) {
    if (rule.regex.test(trimmed)) {
      return rule.brand
    }
  }

  return null
}

/**
 * Compute a neutral single-character monogram for Tier 4 fallback.
 *
 * @param {{ brandName?: string | null, label?: string | null, brandId?: string | null, family?: string | null, modelId?: string | null }} [input]
 * @returns {string}
 */
export function getBrandMonogram(input = {}) {
  const candidates = [input.brandName, input.label, input.brandId, input.family, input.modelId]
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const match = trimmed.match(/[A-Za-z0-9\p{Script=Han}]/u)
    if (match) return match[0].toUpperCase()
    return Array.from(trimmed)[0].toUpperCase()
  }
  return 'M'
}

/**
 * 4-tier deterministic brand visual resolver:
 *
 *   Tier 1 (`local`):
 *     Explicit `brandId` matches local high-craft vector asset (exact or known alias).
 *   Tier 2 (`gateway-path`):
 *     Gateway-provided `brandIconPath` (or `brands[brandId].iconPath` / `icon_path`)
 *     passes fail-closed SVG `<path d>` sanitization.
 *   Tier 3 (`legacy-regex`):
 *     ONLY when no explicit gateway `brandId` was provided (legacy snapshots / BYOK),
 *     resolve local vector via `modelId` or `family` regex.
 *     Explicit unknown gateway `brandId` (e.g. `acme-labs`) skips Tier 3 so a model
 *     like `acme-gpt-vision` is never hijacked by OpenAI's prefix rule.
 *   Tier 4 (`monogram`):
 *     Neutral single-character placeholder (never defaults to `bytedance`).
 *
 * @param {{
 *   brandId?: string | null,
 *   brandName?: string | null,
 *   brandIconPath?: string | null,
 *   modelId?: string | null,
 *   family?: string | null,
 *   label?: string | null,
 *   variant?: 'color' | 'mono',
 *   brands?: Record<string, { id?: string, name?: string, iconPath?: string, icon_path?: string }> | null,
 * }} [input]
 */
export function resolveBrandVisual(input = {}) {
  const variant = input?.variant === 'mono' ? 'mono' : 'color'
  const rawBrandId = typeof input?.brandId === 'string' ? input.brandId : ''
  const validGatewayBrandId = isValidBrandId(rawBrandId) ? rawBrandId : ''
  const aliasedLocalBrand = rawBrandId ? canonicalizeLocalBrandId(rawBrandId) : null
  const hasExplicitBrand = Boolean(validGatewayBrandId || aliasedLocalBrand)

  const brandDictEntry = validGatewayBrandId
    && input?.brands
    && typeof input.brands === 'object'
    && Object.prototype.hasOwnProperty.call(input.brands, validGatewayBrandId)
    ? input.brands[validGatewayBrandId]
    : undefined

  const resolvedName = (typeof input?.brandName === 'string' && input.brandName.trim())
    || (typeof brandDictEntry?.name === 'string' && brandDictEntry.name.trim())
    || (validGatewayBrandId ? getCanonicalBrandName(validGatewayBrandId) : null)
    || (aliasedLocalBrand ? BRAND_CATALOG[aliasedLocalBrand].name : null)
    || null

  // Tier 1: Local high-craft vector asset keyed by canonical brand_id.
  if (aliasedLocalBrand) {
    const entry = BRAND_CATALOG[aliasedLocalBrand]
    return {
      kind: 'svg',
      source: 'local',
      brandId: aliasedLocalBrand,
      brandName: resolvedName || entry.name,
      vector: entry[variant],
    }
  }

  // Tier 2: Gateway-provided safe monochrome 24x24 `<path d>` fallback.
  // An empty string on the row falls through to `brands[brandId]`, while any
  // non-empty invalid string (including padded whitespace) is rejected fail-closed.
  const candidateIconPath = (typeof input?.brandIconPath === 'string' && input.brandIconPath.length > 0)
    ? input.brandIconPath
    : ((typeof brandDictEntry?.iconPath === 'string' && brandDictEntry.iconPath.length > 0)
        ? brandDictEntry.iconPath
        : ((typeof brandDictEntry?.icon_path === 'string' && brandDictEntry.icon_path.length > 0)
            ? brandDictEntry.icon_path
            : null))
  const safePath = sanitizeBrandIconPath(candidateIconPath)

  if (hasExplicitBrand) {
    if (safePath) {
      return {
        kind: 'path',
        source: 'gateway-path',
        brandId: validGatewayBrandId,
        brandName: resolvedName || validGatewayBrandId,
        viewBox: '0 0 24 24',
        path: safePath,
      }
    }
    // Explicit unknown gateway brandId skips Tier 3 regex to prevent misattribution.
    return {
      kind: 'monogram',
      source: 'monogram',
      brandId: validGatewayBrandId,
      brandName: resolvedName || validGatewayBrandId,
      letter: getBrandMonogram({
        brandName: resolvedName,
        brandId: validGatewayBrandId,
        label: input?.label,
        modelId: input?.modelId,
      }),
    }
  }

  // Tier 3: Legacy compatibility regex when gateway omits brand_id (old snapshots / BYOK).
  const legacyBrandId = resolveModelBrand(input?.modelId) || resolveModelBrand(input?.family)
  if (legacyBrandId && Object.prototype.hasOwnProperty.call(BRAND_CATALOG, legacyBrandId)) {
    const entry = BRAND_CATALOG[legacyBrandId]
    return {
      kind: 'svg',
      source: 'legacy-regex',
      brandId: legacyBrandId,
      brandName: resolvedName || entry.name,
      vector: entry[variant],
    }
  }

  if (safePath) {
    return {
      kind: 'path',
      source: 'gateway-path',
      brandId: null,
      brandName: resolvedName,
      viewBox: '0 0 24 24',
      path: safePath,
    }
  }

  // Tier 4: Neutral monogram placeholder.
  return {
    kind: 'monogram',
    source: 'monogram',
    brandId: null,
    brandName: resolvedName,
    letter: getBrandMonogram({
      brandName: resolvedName,
      label: input?.label,
      family: input?.family,
      modelId: input?.modelId,
    }),
  }
}

/**
 * Get brand metadata and serialized SVG (backwards-compatible with hub `getBrandInfo`).
 *
 * @param {string} brandOrModelId
 * @returns {object | null}
 */
export function getBrandInfo(brandOrModelId) {
  const brandId = resolveModelBrand(brandOrModelId)
  if (!brandId || !Object.prototype.hasOwnProperty.call(BRAND_CATALOG, brandId)) return null
  const entry = BRAND_CATALOG[brandId]
  return {
    id: entry.id,
    name: entry.name,
    company: entry.company,
    series: { ...entry.series },
    primaryColor: entry.primaryColor,
    models: [...entry.models],
    svg: BRAND_SVGS[brandId],
    svgMono: BRAND_SVGS_MONO[brandId],
  }
}

/**
 * Return all registered local brands with metadata and SVGs.
 *
 * @returns {Array<object>}
 */
export function getAllBrands() {
  return Object.keys(BRAND_CATALOG).map((id) => getBrandInfo(id))
}
