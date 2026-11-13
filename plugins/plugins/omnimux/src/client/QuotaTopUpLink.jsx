import { Button } from 'dsh-ui-kit'
import { walletUrl } from './quota-failure.js'
import { openWallet, walletUrl as sharedWalletUrl } from './quota-gate.js'

/**
 * Compact recharge affordance under a quota-failed turn.
 * @param {{ t: (key: string) => string, siteBaseUrl?: string }} props
 */
export function QuotaTopUpLink({ t, siteBaseUrl }) {
  const href = sharedWalletUrl() || walletUrl(siteBaseUrl)
  return (
    <div className="omnimux-quota-topup-row" data-omnimux-quota-topup="">
      <span>{t('quota.hint')}</span>
      <Button
        variant="link"
        size="sm"
        className="omnimux-quota-topup-btn"
        onClick={() => openWallet()}
      >
        {t('quota.topUp')}
      </Button>
    </div>
  )
}
