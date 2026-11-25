/** Recovery feedback opens the OmniMux issue page without attaching logs automatically. */
import { OMNIMUX_ISSUES_URL } from './product-identity.ts'

export function recoverySupport(locale: 'zh' | 'en') {
  return {
    href: OMNIMUX_ISSUES_URL,
    label: locale === 'zh' ? '联系我们' : 'Contact us',
    hint: locale === 'zh'
      ? '反馈问题时，请提供下方完整报错和“诊断”中的相关日志，避免只截取最后一行。分享前请检查并隐藏密钥、令牌等敏感信息。'
      : 'When reporting a problem, include the full error below and relevant logs from Diagnostics, not just the last line. Review and redact API keys, tokens and other sensitive information before sharing.',
  }
}
