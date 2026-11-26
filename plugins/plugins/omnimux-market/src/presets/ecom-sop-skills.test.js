import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills')

const ECOM_SOP_SKILLS = [
  'omnimux-ecom-platform-rules',
  'omnimux-ecom-market-research',
  'omnimux-ecom-pricing-strategy',
  'omnimux-ecom-brand-curator',
  'omnimux-ecom-listing-copy',
  'omnimux-ecom-visual-qa',
  'omnimux-ecom-video-script',
  'omnimux-ecom-ads-diagnosis',
  'omnimux-ecom-review-voc',
]

function parseFrontmatter(markdown, label) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)
  assert.ok(match, `${label}: missing YAML frontmatter`)
  const parsed = parseYaml(match[1])
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${label}: frontmatter must be a mapping`)
  return parsed
}

function runPy(scriptRel, args) {
  const scriptPath = join(SKILLS_DIR, scriptRel)
  const res = spawnSync('python3', [scriptPath, ...args], { encoding: 'utf8' })
  return res
}

test('all 9 plugin SOP skills + unified global-ad-localizer are declared with valid frontmatter and zero dead tools', () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'dsh.manifest.json'), 'utf8'))
  assert.ok(Array.isArray(manifest.skills))

  for (const id of ECOM_SOP_SKILLS) {
    const relPath = `skills/${id}/SKILL.md`
    assert.ok(manifest.skills.includes(relPath), `dsh.manifest.json missing ${relPath}`)
    const full = join(PACKAGE_ROOT, relPath)
    assert.equal(existsSync(full), true, `missing ${relPath}`)
    const text = readFileSync(full, 'utf8')
    const fm = parseFrontmatter(text, relPath)
    assert.equal(fm.name, id)
    assert.equal(fm['disable-model-invocation'], true, `${relPath} must keep disable-model-invocation: true`)
    assert.match(fm.description, /[\u4e00-\u9fff]/)
    assert.match(fm.description, /触发[：:]/)
    assert.doesNotMatch(text, /\bharvest_[a-z0-9_]+\b/, `${relPath} must not reference dead harvest_* tools`)
    assert.doesNotMatch(text, /\bvideo_breakdown_analyze\b/, `${relPath} must not reference dead video_breakdown_analyze`)
    assert.doesNotMatch(text, /topview/i, `${relPath} must not leak Topview brand`)
    assert.doesNotMatch(text, /\/Users\/|\/home\//, `${relPath} must not leak host-local paths`)
  }

  const unifiedPath = join(PACKAGE_ROOT, 'catalog', 'skills', 'global-ad-localizer', 'SKILL.md')
  assert.equal(existsSync(unifiedPath), true, 'unified global-ad-localizer SKILL.md must exist')
  const unifiedText = readFileSync(unifiedPath, 'utf8')
  const unifiedFm = parseFrontmatter(unifiedText, 'catalog/skills/global-ad-localizer/SKILL.md')
  assert.equal(unifiedFm.name, 'global-ad-localizer')
  assert.equal(unifiedFm['disable-model-invocation'], true)
  assert.match(unifiedFm.description, /触发[：:]/)
  assert.equal(existsSync(join(SKILLS_DIR, 'omnimux-ecom-global-localizer')), false, 'duplicate localizer dir removed')
})

test('script 01: analyze_market.py parses BR/US/CN numbers, CR3/CR10/HHI, and detects unsmoothed price troughs', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-ecom-market-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const csvPath = join(dir, 'market.csv')
  // Create a clear unsmoothed trough in the middle price band (100-140) between active low (50-90) and high (150-200) bands
  const rows = [
    'brand,price,monthly_sales',
    'ShopA,"R$ 59,90","1,200"',
    'ShopB,"R$ 65,50","1.5万"',
    'ShopC,"$72.00","2k+"',
    'ShopD,"R$ 80,00","800"',
    'ShopE,"R$ 160,00","1.250"',
    'ShopF,"R$ 175,90","900"',
    'ShopG,"R$ 190,00","1,100"',
    'ShopH,"R$ 199,90","950"',
  ]
  writeFileSync(csvPath, rows.join('\n'), 'utf8')
  const res = runPy('omnimux-ecom-market-research/scripts/analyze_market.py', ['--input', csvPath, '--bins', '5', '--format', 'json'])
  assert.equal(res.status, 0, res.stderr)
  const data = JSON.parse(res.stdout)
  assert.equal(data.sample_size, 8)
  assert.equal(data.market_capacity.total_monthly_units, 1200 + 15000 + 2000 + 800 + 1250 + 900 + 1100 + 950)
  assert.ok(data.concentration.cr3 > 0 && data.concentration.cr10 === 1)
  assert.ok(data.concentration.hhi > 0)
  assert.ok(data.price_troughs.length >= 1, 'must detect empty/low mid price-band trough between active neighbors')
})

test('script 02: calc_pricing.py computes exact margin, break-even price, break-even ROAS, and coupon headroom', () => {
  const res = runPy('omnimux-ecom-pricing-strategy/scripts/calc_pricing.py', [
    '--price', '100',
    '--cogs', '25',
    '--shipping', '5',
    '--commission-pct', '20',
    '--payment-pct', '2',
    '--tax-pct', '8',
    '--return-pct', '0',
    '--ad-pct', '10',
    '--target-margin-pct', '15',
    '--format', 'json',
  ])
  assert.equal(res.status, 0, res.stderr)
  const d = JSON.parse(res.stdout)
  // fixed=30, total_pct=40% -> var=40, net_profit=30, net_margin=30%
  // break_even_price = 30 / (1 - 0.40) = 50.0
  // pre_ad_margin = (100*(1-0.30) - 30)/100 = 40% -> break_even_roas = 2.5
  // min_price_for_target(15%) = 30 / (1 - 0.40 - 0.15) = 66.67 -> coupon headroom = 33.33
  assert.equal(d.fixed_cost, 30)
  assert.equal(d.net_profit, 30)
  assert.equal(d.net_margin_pct, 30)
  assert.equal(d.break_even_price, 50)
  assert.equal(d.break_even_roas, 2.5)
  assert.equal(d.min_price_for_target_margin, 66.67)
  assert.equal(d.coupon_headroom_amount, 33.33)
})

test('script 03: validate_listing.py catches title overflow, banned words, and unverified numeric claims', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-ecom-listing-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const badPath = join(dir, 'bad.json')
  writeFileSync(badPath, JSON.stringify({
    title: 'Garrafa Termica Inox 999ml Garantido 100% Melhor do Mundo Frete Gratis Promocao Especial',
    bullets: ['Capacidade real 500ml com vedacao hermetica'],
    description: 'Mantem gelado por 24h com aco 304. Marca concorrente BrandX.',
    spec_table: { capacity: '500ml', material: '304 stainless steel', cold_retention: '12h' },
    forbidden_words: ['BrandX'],
  }), 'utf8')
  const bad = runPy('omnimux-ecom-listing-copy/scripts/validate_listing.py', ['--input', badPath, '--platform', 'mercado_livre', '--format', 'json'])
  assert.equal(bad.status, 2)
  const badJson = JSON.parse(bad.stdout)
  assert.equal(badJson.passed, false)
  const codes = new Set(badJson.issues.map((i) => i.code))
  assert.ok(codes.has('title_too_long'))
  assert.ok(codes.has('title_promotional_spam'))
  assert.ok(codes.has('banned_compliance_term'))
  assert.ok(codes.has('forbidden_word_hit'))
  assert.ok(codes.has('unverified_numeric_spec'))

  const goodPath = join(dir, 'good.json')
  writeFileSync(goodPath, JSON.stringify({
    title: 'Garrafa Termica Aco Inox 304 500ml Parede Dupla',
    bullets: ['Capacidade 500ml em aco 304', 'Conservacao termica de 12h'],
    description: 'Ideal para academia e escritorio, capacidade 500ml.',
    spec_table: { capacity: '500ml', material: '304', retention: '12h' },
    forbidden_words: ['BrandX'],
  }), 'utf8')
  const good = runPy('omnimux-ecom-listing-copy/scripts/validate_listing.py', ['--input', goodPath, '--platform', 'mercado_livre', '--format', 'json'])
  assert.equal(good.status, 0, good.stdout + good.stderr)
  assert.equal(JSON.parse(good.stdout).passed, true)
})

test('script 04: check_main_image.py detects non-compliant PNG and --fix produces Amazon-compliant 1200x1200 white PNG', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-ecom-img-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const rawPng = join(dir, 'raw.png')
  const fixedPng = join(dir, 'fixed.png')

  // Generate a 400x300 non-square PNG with gray background + dark centered product block via pure stdlib
  const gen = spawnSync('python3', ['-c', `
import struct, zlib, sys
w, h = 400, 300
rgb = bytearray([200, 200, 200] * (w * h))
for y in range(100, 200):
    for x in range(150, 250):
        i = (y * w + x) * 3
        rgb[i:i+3] = bytes([40, 80, 160])
# Make border slightly off-white on top/bottom too
raw = bytearray()
for y in range(h):
    raw.append(0)
    raw.extend(rgb[y*w*3:(y+1)*w*3])
def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
open(sys.argv[1], 'wb').write(b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw))) + chunk(b'IEND', b''))
`, rawPng], { encoding: 'utf8' })
  assert.equal(gen.status, 0, gen.stderr)

  const checkRaw = runPy('omnimux-ecom-visual-qa/scripts/check_main_image.py', ['--input', rawPng, '--platform', 'amazon', '--format', 'json'])
  assert.equal(checkRaw.status, 2)
  const rawJson = JSON.parse(checkRaw.stdout)
  assert.equal(rawJson.passed, false)
  const rawCodes = new Set(rawJson.issues.map((i) => i.code))
  assert.ok(rawCodes.has('resolution_too_low'))
  assert.ok(rawCodes.has('aspect_not_square'))
  assert.ok(rawCodes.has('background_not_pure_white'))

  const fixRes = runPy('omnimux-ecom-visual-qa/scripts/check_main_image.py', ['--input', rawPng, '--platform', 'amazon', '--fix', '--output', fixedPng, '--format', 'json'])
  assert.equal(fixRes.status, 0, fixRes.stdout + fixRes.stderr)
  const fixJson = JSON.parse(fixRes.stdout)
  assert.equal(fixJson.post_fix_check.passed, true)
  assert.equal(fixJson.post_fix_check.width, 1200)
  assert.equal(fixJson.post_fix_check.height, 1200)
  assert.ok(fixJson.post_fix_check.metrics.white_border_ratio >= 0.95)
})

test('script 05: validate_video_script.py validates 3s hook, duration, spec provenance, and exports valid SRT', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-ecom-video-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const goodPath = join(dir, 'script.json')
  const srtPath = join(dir, 'captions.srt')
  writeFileSync(goodPath, JSON.stringify({
    target_duration_sec: 15,
    language: 'en',
    spec_table: { capacity: '500ml', battery: '12h' },
    forbidden_words: ['BrandX'],
    scenes: [
      { start: 0, end: 3, visual: 'Ice cube drop', voiceover: 'Still drinking lukewarm water at work?', on_screen_text: 'Stop lukewarm water' },
      { start: 3, end: 11, visual: 'Pouring test', voiceover: 'This 500ml insulated bottle stays chilled for 12h straight without leaking in your gym bag.', on_screen_text: '500ml · 12h cold' },
      { start: 11, end: 15, visual: 'CTA cart', voiceover: 'Tap the basket below to check colors now.', on_screen_text: 'Tap basket below' },
    ],
  }), 'utf8')
  const res = runPy('omnimux-ecom-video-script/scripts/validate_video_script.py', ['--input', goodPath, '--srt', srtPath, '--format', 'json'])
  assert.equal(res.status, 0, res.stdout + res.stderr)
  const out = JSON.parse(res.stdout)
  assert.equal(out.passed, true)
  const srt = readFileSync(srtPath, 'utf8')
  assert.match(srt, /00:00:00,000 --> 00:00:03,000/)
  assert.match(srt, /00:00:11,000 --> 00:00:15,000/)
})

test('script 06: diagnose_ads.py isolates high-CTR / low-CVR bottleneck without blaming main image', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-ecom-ads-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const csvPath = join(dir, 'ads.csv')
  writeFileSync(csvPath, [
    'campaign,impressions,clicks,atc,orders,spend,revenue',
    'HighCTR_LowCVR,10000,300,15,2,180,160',
    'LowCTR_NeedThumb,10000,60,8,3,60,240',
  ].join('\n'), 'utf8')
  const res = runPy('omnimux-ecom-ads-diagnosis/scripts/diagnose_ads.py', [
    '--input', csvPath,
    '--price', '80',
    '--pre-ad-margin-pct', '40',
    '--platform', 'shopee',
    '--format', 'json',
  ])
  assert.equal(res.status, 0, res.stderr)
  const out = JSON.parse(res.stdout)
  assert.equal(out.summary.break_even_roas, 2.5)
  const c1 = out.campaigns.find((c) => c.campaign === 'HighCTR_LowCVR')
  assert.equal(c1.diagnosis.bottleneck, 'cvr_listing_trust_bottleneck')
  assert.equal(c1.diagnosis.route_to_expert, 'ecom-listing-copy')
  assert.ok(c1.diagnosis.do_not_touch.includes('main_image_thumbnail'))
  assert.equal(c1.diagnosis.auto_mutate_console, false)

  const c2 = out.campaigns.find((c) => c.campaign === 'LowCTR_NeedThumb')
  assert.equal(c2.diagnosis.bottleneck, 'ctr_bottleneck')
  assert.equal(c2.diagnosis.route_to_expert, 'ecom-visual-studio')
})

test('script 07: analyze_reviews.py enforces 8-cause count conservation and fixable misunderstanding rate', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-ecom-voc-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const csvPath = join(dir, 'reviews.csv')
  writeFileSync(csvPath, [
    'rating,text',
    '1,"Too small compared to my old bottle, check the size!"',
    '2,"No instructions in the box, hard to figure out how to use."',
    '2,"Not compatible with my 220v plug."',
    '1,"Stopped working after two days, leaking badly."',
    '1,"Arrived crushed and broken on arrival."',
    '5,"Sturdy build quality and very easy to use!"',
    '5,"Great value and fast shipping, looks great."',
  ].join('\n'), 'utf8')
  const res = runPy('omnimux-ecom-review-voc/scripts/analyze_reviews.py', ['--input', csvPath, '--format', 'json'])
  assert.equal(res.status, 0, res.stderr)
  const out = JSON.parse(res.stdout)
  assert.equal(out.summary.total_reviews, 7)
  assert.equal(out.summary.negative_reviews, 5)
  assert.equal(out.summary.positive_reviews, 2)
  assert.equal(out.summary.negative_count_reconciled, true)
  const sumCats = out.negative_attribution.reduce((acc, row) => acc + row.count, 0)
  assert.equal(sumCats, 5)
  assert.equal(out.summary.fixable_misunderstanding_count, 3)
  assert.equal(out.summary.fixable_misunderstanding_rate, 0.6)
  assert.ok(out.positive_selling_points.length >= 2)
})

test('script 08: validate_brand_kit.py validates complete kit (pass), missing anchor (needs_input), and invalid hex/banned claims (fail)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-ecom-brand-kit-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const goodPath = join(dir, 'good.json')
  writeFileSync(goodPath, JSON.stringify({
    product_name: 'AeroFlask 500ml Insulated Tumbler',
    category: 'Kitchen & Drinkware',
    core_selling_point: 'Double-wall 304 steel keeps drinks chilled for 12h without leaks',
    target_markets: ['us', 'br'],
    spec_table: { capacity: '500ml', material: '304 stainless steel', weight: '320g', cold_retention: '12h' },
    brand_palette: ['#1a2b3c', '#fff'],
    forbidden_words: ['BrandX', 'Yeti'],
    anchor_assets: { hero_photo: 'assets/hero-front.png', angle_photos: ['assets/side.png'] },
  }), 'utf8')
  const goodRes = runPy('omnimux-ecom-brand-curator/scripts/validate_brand_kit.py', ['--input', goodPath, '--format', 'json'])
  assert.equal(goodRes.status, 0, goodRes.stdout + goodRes.stderr)
  const goodOut = JSON.parse(goodRes.stdout)
  assert.equal(goodOut.status, 'pass')
  assert.equal(goodOut.passed, true)
  assert.equal(goodOut.score, 100)
  assert.deepEqual(goodOut.normalized_kit.brand_palette, ['#1A2B3C', '#FFFFFF'])
  assert.deepEqual(goodOut.normalized_kit.target_markets, ['US', 'BR'])

  const needsPath = join(dir, 'needs.json')
  writeFileSync(needsPath, JSON.stringify({
    product_name: 'AeroFlask 500ml',
    category: 'Drinkware',
    core_selling_point: 'Leakproof commuter tumbler',
    target_markets: ['US'],
    spec_table: { capacity: '500ml', weight: '320g', material: '304 steel' },
    brand_palette: ['#112233'],
    forbidden_words: ['BrandX'],
    anchor_assets: {},
  }), 'utf8')
  const needsRes = runPy('omnimux-ecom-brand-curator/scripts/validate_brand_kit.py', ['--input', needsPath, '--format', 'json'])
  assert.equal(needsRes.status, 2)
  const needsOut = JSON.parse(needsRes.stdout)
  assert.equal(needsOut.status, 'needs_input')
  assert.ok(needsOut.missing_fields.includes('anchor_assets.hero_photo'))

  const badPath = join(dir, 'bad.json')
  writeFileSync(badPath, JSON.stringify({
    product_name: 'Miracle Tumbler',
    category: '',
    core_selling_point: '100% guaranteed miracle cure best in the world',
    target_markets: [],
    spec_table: { material: 'plastic' },
    brand_palette: ['not-a-hex'],
    forbidden_words: [],
  }), 'utf8')
  const badRes = runPy('omnimux-ecom-brand-curator/scripts/validate_brand_kit.py', ['--input', badPath, '--format', 'json'])
  assert.equal(badRes.status, 2)
  const badOut = JSON.parse(badRes.stdout)
  assert.equal(badOut.status, 'fail')
  const badCodes = new Set(badOut.issues.map((i) => i.code))
  assert.ok(badCodes.has('missing_category'))
  assert.ok(badCodes.has('banned_claim_in_usp'))
  assert.ok(badCodes.has('missing_target_markets'))
  assert.ok(badCodes.has('insufficient_specs'))
  assert.ok(badCodes.has('invalid_palette_hex'))

  // Regression: JSON null values must NEVER coerce to "None" and 100% must count as measured unit
  const nullSpecsPath = join(dir, 'null-specs.json')
  writeFileSync(nullSpecsPath, JSON.stringify({
    product_name: 'Cotton Tee',
    category: 'Apparel',
    core_selling_point: 'Breathable 100% combed cotton daily tee',
    target_markets: ['US', null],
    spec_table: { cotton: '100%', lining: null, trim: null },
    brand_palette: ['#112233'],
    forbidden_words: ['BrandX', null],
    anchor_assets: { hero_photo: 'assets/hero.png', angle_photos: [null] },
  }), 'utf8')
  const nullSpecsRes = runPy('omnimux-ecom-brand-curator/scripts/validate_brand_kit.py', ['--input', nullSpecsPath, '--format', 'json'])
  assert.equal(nullSpecsRes.status, 2)
  const nullSpecsOut = JSON.parse(nullSpecsRes.stdout)
  assert.equal(nullSpecsOut.status, 'fail')
  assert.equal(nullSpecsOut.metrics.spec_count, 1)
  assert.equal(nullSpecsOut.metrics.measured_spec_count, 1, '100% must match NUMERIC_UNIT_RE')
  assert.deepEqual(nullSpecsOut.normalized_kit.spec_table, { cotton: '100%' })
  assert.deepEqual(nullSpecsOut.normalized_kit.target_markets, ['US'])
  assert.deepEqual(nullSpecsOut.normalized_kit.forbidden_words, ['BrandX'])
  assert.ok(nullSpecsOut.issues.some((i) => i.code === 'insufficient_specs'))
})

test('script 09: check_localization_matrix.py passes valid multilingual shots and blocks voiceover overflow, spec drift (including CJK/%/unit drift), and banned claims', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-ecom-loc-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const goodPath = join(dir, 'good.json')
  writeFileSync(goodPath, JSON.stringify({
    spec_table: { capacity: '500ml', retention: '12 hours', uv_block: '98%' },
    forbidden_words: ['BrandX'],
    markets: [
      {
        market: 'US',
        lang: 'en-US',
        shots: [
          { shot_id: 'S1', duration_sec: 4, voiceover: 'Still drinking warm water at work?', subtitle: 'Warm water again?' },
          { shot_id: 'S2', duration_sec: 6, voiceover: 'This 500ml bottle keeps ice cold for 12h straight with 98% UV shield.', subtitle: '500ml 12h cold 98%' },
        ],
      },
      {
        market: 'JP',
        lang: 'ja',
        shots: [
          { shot_id: 'S1', duration_sec: 4, voiceover: 'ぬるい水にさよなら。', subtitle: 'ぬるい水にさよなら' },
          { shot_id: 'S2', duration_sec: 5, voiceover: '500mlで12hしっかり保冷。', subtitle: '500ml 12h保冷' },
        ],
      },
    ],
  }), 'utf8')
  const goodRes = runPy('../catalog/skills/global-ad-localizer/scripts/check_localization_matrix.py', ['--input', goodPath, '--format', 'json'])
  assert.equal(goodRes.status, 0, goodRes.stdout + goodRes.stderr)
  const goodOut = JSON.parse(goodRes.stdout)
  assert.equal(goodOut.passed, true)
  assert.equal(goodOut.markets.length, 2)

  const badPath = join(dir, 'bad.json')
  writeFileSync(badPath, JSON.stringify({
    spec_table: { capacity: '500ml', retention: '12h' },
    forbidden_words: ['BrandX'],
    markets: [
      {
        market: 'BR',
        lang: 'pt-BR',
        shots: [
          {
            shot_id: 'S1',
            duration_sec: 3,
            voiceover: 'Esta garrafa termica incrivel de 900ml mantem sua bebida gelada por 48h garantido 100% muito melhor do que BrandX no escritorio e na academia todos os dias.',
            subtitle: '900ml 48h garantido 100%',
          },
        ],
      },
    ],
  }), 'utf8')
  const badRes = runPy('../catalog/skills/global-ad-localizer/scripts/check_localization_matrix.py', ['--input', badPath, '--format', 'json'])
  assert.equal(badRes.status, 2)
  const badOut = JSON.parse(badRes.stdout)
  assert.equal(badOut.passed, false)
  const badCodes = new Set(badOut.issues.map((i) => i.code))
  assert.ok(badCodes.has('voiceover_overflow'))
  assert.ok(badCodes.has('banned_compliance_term'))
  assert.ok(badCodes.has('forbidden_word_hit'))
  assert.ok(badCodes.has('unverified_numeric_spec'))

  // Regression: CJK adjacent numbers, unit mistranslation (500ml -> 500L, 12h -> 12 days), and % drift MUST fail
  const driftPath = join(dir, 'drift.json')
  writeFileSync(driftPath, JSON.stringify({
    spec_table: { capacity: '500ml', retention: '12h' },
    markets: [
      {
        market: 'JP',
        lang: 'ja',
        shots: [
          { shot_id: 'S_JP', duration_sec: 5, voiceover: '999mlで99hしっかり保冷。', subtitle: '这款999ml保温杯' },
        ],
      },
      {
        market: 'US',
        lang: 'en-US',
        shots: [
          { shot_id: 'S_UNIT', duration_sec: 6, voiceover: 'This 500L tank runs 12 days.', subtitle: 'Blocks 99% UV rays.' },
        ],
      },
    ],
  }), 'utf8')
  const driftRes = runPy('../catalog/skills/global-ad-localizer/scripts/check_localization_matrix.py', ['--input', driftPath, '--format', 'json'])
  assert.equal(driftRes.status, 2)
  const driftOut = JSON.parse(driftRes.stdout)
  assert.equal(driftOut.passed, false)
  const driftMsgs = driftOut.issues.filter((i) => i.code === 'unverified_numeric_spec').map((i) => i.message).join('\n')
  assert.match(driftMsgs, /999ml/, 'must catch CJK-adjacent ml drift')
  assert.match(driftMsgs, /99h/, 'must catch CJK-adjacent h drift')
  assert.match(driftMsgs, /500L/, 'must catch unit drift from 500ml to 500L')
  assert.match(driftMsgs, /12 days/, 'must catch unit drift from 12h to 12 days')
  assert.match(driftMsgs, /99%/, 'must catch unverified percentage drift')
})
