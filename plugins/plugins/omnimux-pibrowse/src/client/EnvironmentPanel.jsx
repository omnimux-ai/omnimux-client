import { useEffect, useState } from 'react'
import { Badge, Button, ConfirmModal, InputField, ModalDialog } from 'dsh-ui-kit'
import { requestFilePicker } from 'dsh-ui-kit/native-file-picker'
import { api } from './api.js'

export function EnvironmentPanel({ overview, t, onNotify, onOverviewChanged }) {
  const [busyAction, setBusyAction] = useState(null)
  const [pathsOpen, setPathsOpen] = useState(false)
  const [clearCacheOpen, setClearCacheOpen] = useState(false)
  const [agentPathInput, setAgentPathInput] = useState(overview?.config?.agentPath || '')
  const [corePathInput, setCorePathInput] = useState(overview?.config?.corePath || '')

  useEffect(() => {
    setAgentPathInput(overview?.config?.agentPath || '')
    setCorePathInput(overview?.config?.corePath || '')
  }, [overview?.config?.agentPath, overview?.config?.corePath])

  const sidecar = overview?.sidecar || {}
  const platform = overview?.platform || {}
  const agent = overview?.agent || {}
  const core = overview?.core || {}
  const widevine = overview?.widevine || {}
  const mcp = overview?.mcp || {}
  const installer = overview?.installer || {}

  const runRuntime = async (action, payload = {}) => {
    setBusyAction(action)
    try {
      await api.runtime({ action, ...payload })
      await onOverviewChanged()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : `操作 ${action} 失败`, true)
    } finally {
      setBusyAction(null)
    }
  }

  const pickPath = async (setter, mode, title) => {
    const picked = await requestFilePicker(
      { mode, title },
      async () => ({ ok: false, status: 503, body: { path: null } }),
    )
    if (picked?.ok && picked.body?.path) {
      setter(picked.body.path)
    }
  }

  const activeProgress =
    installer.agent?.status === 'downloading' || installer.agent?.status === 'extracting'
      ? installer.agent.progress?.percent ?? 50
      : installer.core?.status === 'downloading' || installer.core?.status === 'extracting'
        ? installer.core.progress?.percent ?? 50
        : null

  return (
    <>
      <div className="omnimux-pibrowse-two-col">
        <div className="omnimux-pibrowse-card">
          <div className="omnimux-pibrowse-card-head">
            <h2 className="omnimux-pibrowse-card-title">{t('envSidecarTitle')}</h2>
            <Badge variant={sidecar.running ? 'success' : sidecar.state === 'error' ? 'error' : 'neutral'}>
              {sidecar.running ? t('statusRunningOpt') : sidecar.state === 'error' ? t('statusError') : t('statusStopped')}
            </Badge>
          </div>
          <div className="omnimux-pibrowse-kv-list">
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">目标平台</span>
              <span className="omnimux-pibrowse-kv-v omnimux-pibrowse-mono">
                {platform.targetKey || 'unknown'}{platform.prebuiltSupported ? '' : '（无预编译包）'}
              </span>
            </div>
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">Sidecar PID</span>
              <span className="omnimux-pibrowse-kv-v omnimux-pibrowse-mono">
                {sidecar.running && sidecar.pid ? String(sidecar.pid) : '—'}
              </span>
            </div>
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">隔离数据目录</span>
              <span className="omnimux-pibrowse-kv-v omnimux-pibrowse-mono">
                {overview?.paths?.dataDir || '$DSH_HOME/omnimux/pibrowse/data'}
              </span>
            </div>
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">FURY_SOCKET</span>
              <span className="omnimux-pibrowse-kv-v omnimux-pibrowse-mono">
                {overview?.paths?.socketPath || '—'}
              </span>
            </div>
          </div>

          <div className="omnimux-pibrowse-row">
            {sidecar.running ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busyAction === 'restart'}
                  onClick={() => runRuntime('restart')}
                >
                  {t('restartSidecar')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={busyAction === 'stop'}
                  onClick={() => runRuntime('stop', { stopProfiles: true })}
                >
                  {t('stopSidecar')}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                disabled={!agent.installed}
                loading={busyAction === 'start'}
                onClick={() => runRuntime('start')}
              >
                {t('startSidecar')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setClearCacheOpen(true)}>
              {t('clearCache')}
            </Button>
          </div>
        </div>

        <div className="omnimux-pibrowse-card">
          <div className="omnimux-pibrowse-card-head">
            <h2 className="omnimux-pibrowse-card-title">{t('envBinariesTitle')}</h2>
            <Badge variant="info">
              {overview?.upstream?.releaseTag || 'v0.5.5'} / Chromium {overview?.upstream?.chromiumVersion || '157.0.8103.39'}
            </Badge>
          </div>

          <div className="omnimux-pibrowse-kv-list">
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">fury-agent</span>
              <span className="omnimux-pibrowse-kv-v omnimux-pibrowse-mono">
                {agent.installed ? `${agent.source} (${agent.path})` : '未安装'}
              </span>
            </div>
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">FURY_CORE</span>
              <span className="omnimux-pibrowse-kv-v omnimux-pibrowse-mono">
                {core.installed ? `${core.source} (${core.path})` : '未安装'}
              </span>
            </div>
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">Widevine CDM</span>
              <span className="omnimux-pibrowse-kv-v">
                {widevine.available ? (
                  <Badge variant="success">检测到本机 Chrome CDM</Badge>
                ) : (
                  <Badge variant="warning">未检测到 Chrome，DRM 受限</Badge>
                )}
              </span>
            </div>
          </div>

          {activeProgress !== null && (
            <div className="omnimux-pibrowse-progress-track" role="progressbar" aria-valuenow={activeProgress} aria-valuemin={0} aria-valuemax={100}>
              <div className="omnimux-pibrowse-progress-fill" style={{ '--pb-progress': `${activeProgress}%` }} />
            </div>
          )}

          <div className="omnimux-pibrowse-row">
            {platform.prebuiltSupported && (
              <>
                <Button
                  variant={agent.installed ? 'secondary' : 'primary'}
                  size="sm"
                  loading={busyAction === 'install_agent'}
                  onClick={() => runRuntime('install_agent')}
                >
                  {t('downloadAgent')}
                </Button>
                <Button
                  variant={agent.installed && !core.installed ? 'primary' : 'outline'}
                  size="sm"
                  disabled={!agent.installed}
                  loading={busyAction === 'install_core'}
                  onClick={() => runRuntime('install_core')}
                >
                  {t('downloadCore')}
                </Button>
              </>
            )}
            {agent.standaloneCandidate && !agent.installed && (
              <Button
                variant="secondary"
                size="sm"
                loading={busyAction === 'reuse_standalone'}
                onClick={() => runRuntime('reuse_standalone')}
              >
                {t('reuseStandalone')}
              </Button>
            )}
            <Button
              variant={platform.prebuiltSupported ? 'outline' : 'primary'}
              size="sm"
              onClick={() => setPathsOpen(true)}
            >
              {t('manualPaths')}
            </Button>
          </div>
        </div>
      </div>

      <div className="omnimux-pibrowse-card">
        <div className="omnimux-pibrowse-card-head">
          <h2 className="omnimux-pibrowse-card-title">{t('envMcpTitle')}</h2>
          <Badge variant={mcp.registered ? 'success' : 'neutral'}>
            {mcp.registered ? `mcp__pibrowse 已注册（${mcp.mountedToolsCount || 0} 工具）` : `MCP ${mcp.state || 'idle'}`}
          </Badge>
        </div>
        <div className="omnimux-pibrowse-kv-list">
          <div className="omnimux-pibrowse-kv">
            <span className="omnimux-pibrowse-kv-k">上游 MCP 工具前缀</span>
            <span className="omnimux-pibrowse-kv-v omnimux-pibrowse-mono">
              mcp__pibrowse__fury_*（预期 {mcp.expectedToolsCount || 19} 工具）
            </span>
          </div>
          <div className="omnimux-pibrowse-kv">
            <span className="omnimux-pibrowse-kv-k">宿主管理面工具</span>
            <span className="omnimux-pibrowse-kv-v omnimux-pibrowse-mono">
              pibrowse_*（8 工具，破坏性操作带 confirm 守卫）
            </span>
          </div>
          <div className="omnimux-pibrowse-kv">
            <span className="omnimux-pibrowse-kv-k">macOS 首次授权提示</span>
            <span className="omnimux-pibrowse-kv-v">
              上游预览二进制为 ad-hoc 签名，若被系统拦截请前往系统设置「隐私与安全性」点击允许运行
            </span>
          </div>
        </div>
        <div className="omnimux-pibrowse-row">
          <Button variant="secondary" size="sm" loading={busyAction === 'probe_mcp'} onClick={() => runRuntime('probe_mcp')}>
            {t('probeMcp')}
          </Button>
          <Button variant="outline" size="sm" loading={busyAction === 'restart_mcp'} onClick={() => runRuntime('restart_mcp')}>
            {t('restartMcp')}
          </Button>
        </div>
        {Array.isArray(sidecar.recentLogs) && sidecar.recentLogs.length > 0 && (
          <pre className="omnimux-pibrowse-log">
            {sidecar.recentLogs.map((l) => `[${l.ts}] ${l.stream}: ${l.message}`).join('\n')}
          </pre>
        )}
      </div>

      <ModalDialog
        open={pathsOpen}
        onClose={() => setPathsOpen(false)}
        title={t('manualPaths')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setPathsOpen(false)}>{t('cancel')}</Button>
            <Button
              variant="primary"
              loading={busyAction === 'configure_paths'}
              onClick={async () => {
                await runRuntime('configure_paths', {
                  agentPath: agentPathInput.trim() || null,
                  corePath: corePathInput.trim() || null,
                })
                setPathsOpen(false)
              }}
            >
              {t('save')}
            </Button>
          </div>
        }
      >
        <div className="omnimux-pibrowse-field">
          <div className="omnimux-pibrowse-row">
            <InputField
              label="fury-agent 二进制绝对路径"
              value={agentPathInput}
              onChange={(e) => setAgentPathInput(e.target.value)}
              placeholder="/Applications/PiBrowse.app/Contents/MacOS/fury-agent"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => pickPath(setAgentPathInput, 'file', '选择 fury-agent 二进制')}
            >
              选择文件
            </Button>
          </div>
          <div className="omnimux-pibrowse-row">
            <InputField
              label="FURY_CORE Chromium 内核路径（可选）"
              value={corePathInput}
              onChange={(e) => setCorePathInput(e.target.value)}
              placeholder="/path/to/FuryCore.app"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => pickPath(setCorePathInput, 'directory', '选择 FURY_CORE 目录')}
            >
              选择目录
            </Button>
          </div>
        </div>
      </ModalDialog>

      <ConfirmModal
        open={clearCacheOpen}
        onClose={() => setClearCacheOpen(false)}
        title={t('clearCache')}
        message="确认清理已下载安装包与 Chromium 内核缓存？不会删除现有配置文件数据。"
        confirmLabel={t('clearCache')}
        cancelLabel={t('cancel')}
        confirmVariant="danger"
        confirmLoading={busyAction === 'clear_cache'}
        onConfirm={async () => {
          await runRuntime('clear_cache', { confirm: true })
          setClearCacheOpen(false)
        }}
      />
    </>
  )
}
