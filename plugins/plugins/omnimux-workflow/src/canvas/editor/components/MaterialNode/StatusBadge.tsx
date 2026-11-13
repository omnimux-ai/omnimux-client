/**
 * StatusBadge — 节点执行与降级状态徽标。
 *
 * 语义保留：executionStatus（SSE 写入）优先，回退本地 status；
 * 支持非破坏性降级/超限警示徽标（isDegraded / degradedWarning）；
 * CSS 类复用 theme 的 wf-material-node__badge* 块。
 */

import { memo, useMemo } from 'react';
import type { MaterialStatus } from '../../../types/materialNode';
import type { NodeExecutionApiStatus } from '../../../../shared/api';
import { useT } from '../../../i18n';

export interface StatusBadgeProps {
  executionStatus?: NodeExecutionApiStatus;
  status?: MaterialStatus;
  isDegraded?: boolean;
  degradedWarning?: string;
  simulated?: boolean;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({
  executionStatus,
  status,
  isDegraded,
  degradedWarning,
  simulated,
}) => {
  const t = useT();
  const badge = useMemo(() => {
    if (simulated && executionStatus === 'completed') {
      return (
        <span
          className="wf-material-node__badge wf-material-node__badge--simulated"
          title={t('node.simulatedResult')}
        >
          {t('node.simulatedResult')}
        </span>
      );
    }
    switch (executionStatus) {
      case 'running':
        return <span className="wf-material-node__badge wf-material-node__badge--running wf-material-node__badge--spin" />;
      case 'completed':
        return <span className="wf-material-node__badge wf-material-node__badge--done" />;
      case 'error':
        return <span className="wf-material-node__badge wf-material-node__badge--failed" />;
      case 'skipped':
        return <span className="wf-material-node__badge wf-material-node__badge--skipped" title={t('node.skipped')} />;
      case 'pending':
        return <span className="wf-material-node__badge wf-material-node__badge--pending" />;
      default:
        break;
    }
    switch (status) {
      case 'generating':
        return <span className="wf-material-node__badge wf-material-node__badge--running wf-material-node__badge--spin" />;
      case 'completed':
        return <span className="wf-material-node__badge wf-material-node__badge--done" />;
      case 'failed':
        return <span className="wf-material-node__badge wf-material-node__badge--failed" />;
      case 'offline':
        return (
          <span
            className="wf-material-node__badge wf-material-node__badge--offline"
            title={t('node.offline')}
          />
        );
      default:
        break;
    }

    if (isDegraded) {
      return (
        <span
          className="wf-material-node__badge wf-material-node__badge--degraded"
          title={degradedWarning || t('model.compatibility.degradedWarning')}
        />
      );
    }

    return null;
  }, [executionStatus, status, isDegraded, degradedWarning, simulated, t]);

  return badge;
};

export default memo(StatusBadge);
