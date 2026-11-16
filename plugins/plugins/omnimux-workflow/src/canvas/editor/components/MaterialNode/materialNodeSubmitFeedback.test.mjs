/**
 * #48 v2：MaterialNode → ConfigPanel → GenerateButton 的提交反馈接线。
 *
 * 行为由子组件测试与 execution controller 测试覆盖；这里钉住共享组件的
 * 单一接线：图片/视频都走同一个 MaterialNode 与同一个 isSubmitting 通道。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const materialNodeSrc = readFileSync(join(here, 'index.tsx'), 'utf8')
const configPanelSrc = readFileSync(join(here, 'ConfigPanel/index.tsx'), 'utf8')
const generateButtonSrc = readFileSync(join(here, 'ConfigPanel/GenerateButton.tsx'), 'utf8')

test('#48 MaterialNode：点击入口同步 guard，且立即调用 startNodeExecution', () => {
  assert.match(materialNodeSrc, /const \[submitPending, setSubmitPending\] = useState\(false\)/)
  assert.match(materialNodeSrc, /const submitPendingRef = useRef\(false\)/)
  assert.match(materialNodeSrc, /if \(submitPendingRef\.current\) return;/)
  assert.match(materialNodeSrc, /submitNodeImmediate\(/)
  assert.match(materialNodeSrc, /isSubmitting=\{submitPending\}/)
  assert.match(materialNodeSrc, /quota\.ensureQuota/)
})

test('#48 图片/视频共用同一个 ConfigPanel → GenerateButton 通道', () => {
  // MaterialNode 的生成按钮接线没有 materialType 分支：图片和视频同源。
  assert.match(materialNodeSrc, /<ConfigPanel[\s\S]*?onGenerate=\{handleGenerate\}[\s\S]*?isSubmitting=\{submitPending\}/)
  assert.match(configPanelSrc, /isSubmitting\?: boolean/)
  assert.match(configPanelSrc, /isSubmitting=\{isSubmitting\}/)
  assert.match(configPanelSrc, /nodeData\.executionStatus === 'pending'/)
  assert.match(generateButtonSrc, /isSubmitting\?: boolean/)
  assert.match(generateButtonSrc, /data-submission-state=\{submissionState\}/)
  assert.match(generateButtonSrc, />…</)
  assert.doesNotMatch(generateButtonSrc, /Loader2|wf-generate-btn__spin|animate-spin/)
})
