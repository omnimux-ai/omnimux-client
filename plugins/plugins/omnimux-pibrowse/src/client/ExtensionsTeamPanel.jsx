import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  ConfirmModal,
  CopyButton,
  DropdownSelect,
  EmptyState,
  InputField,
  ModalDialog,
} from 'dsh-ui-kit'
import { requestFilePicker } from 'dsh-ui-kit/native-file-picker'
import { api } from './api.js'

export function ExtensionsTeamPanel({ overview, t, onNotify, onOverviewChanged }) {
  const [extensions, setExtensions] = useState([])
  const [teamProjects, setTeamProjects] = useState([])
  const [teamProfiles, setTeamProfiles] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [auditEvents, setAuditEvents] = useState([])
  const [localProfiles, setLocalProfiles] = useState([])
  const [busyId, setBusyId] = useState(null)

  const [installExtOpen, setInstallExtOpen] = useState(false)
  const [extSource, setExtSource] = useState('')
  const [removeExtTarget, setRemoveExtTarget] = useState(null)

  const [loginOpen, setLoginOpen] = useState(false)
  const [signupOpen, setSignupOpen] = useState(false)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false)
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false)

  const [serverUrl, setServerUrl] = useState(overview?.team?.configuredServerUrl || '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [rememberOrgKey, setRememberOrgKey] = useState(Boolean(overview?.team?.rememberOrgKey))
  const [inviteToken, setInviteToken] = useState('')
  const [signupName, setSignupName] = useState('')

  const [handoverMemberId, setHandoverMemberId] = useState('')
  const [handoverCodeInput, setHandoverCodeInput] = useState('')
  const [projectName, setProjectName] = useState('')
  const [shareProfileId, setShareProfileId] = useState('')
  const [shareProjectId, setShareProjectId] = useState('all')

  const team = overview?.team || {}
  const sidecarRunning = Boolean(overview?.sidecar?.running)

  useEffect(() => {
    if (overview?.team?.configuredServerUrl && !serverUrl) {
      setServerUrl(overview.team.configuredServerUrl)
    }
  }, [overview?.team?.configuredServerUrl, serverUrl])

  const loadData = useCallback(async () => {
    if (sidecarRunning) {
      const [extRes, localRes] = await Promise.all([
        api.listExtensions().catch((err) => {
          onNotify(err instanceof Error ? err.message : '加载扩展列表失败', true)
          return { extensions: [] }
        }),
        api.listProfiles({}).catch((err) => {
          onNotify(err instanceof Error ? err.message : '加载本地配置失败', true)
          return { profiles: [] }
        }),
      ])
      setExtensions(Array.isArray(extRes?.extensions) ? extRes.extensions : [])
      setLocalProfiles(Array.isArray(localRes?.profiles) ? localRes.profiles : [])
    } else {
      setExtensions([])
    }

    if (team.signedIn) {
      const [projRes, profRes, memRes] = await Promise.all([
        api.teamSync({ action: 'list_projects' }).catch((err) => {
          onNotify(err instanceof Error ? err.message : '加载团队项目失败', true)
          return { projects: [] }
        }),
        api.teamSync({ action: 'list_profiles' }).catch((err) => {
          onNotify(err instanceof Error ? err.message : '加载团队配置失败', true)
          return { profiles: [] }
        }),
        api.teamSync({ action: 'list_members' }).catch((err) => {
          onNotify(err instanceof Error ? err.message : '加载团队成员失败', true)
          return { members: [] }
        }),
      ])
      setTeamProjects(Array.isArray(projRes?.projects) ? projRes.projects : [])
      setTeamProfiles(Array.isArray(profRes?.profiles) ? profRes.profiles : [])
      setTeamMembers(Array.isArray(memRes?.members) ? memRes.members : [])
    } else {
      setTeamProjects([])
      setTeamProfiles([])
      setTeamMembers([])
    }
  }, [sidecarRunning, team.signedIn, onNotify])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handlePickExtension = async () => {
    const picked = await requestFilePicker(
      { mode: 'file', title: '选择 .crx 扩展包文件' },
      async () => ({ ok: false, status: 503, body: { path: null } }),
    )
    if (picked?.ok && picked.body?.path) {
      setExtSource(picked.body.path)
    }
    setInstallExtOpen(true)
  }

  const handleInstallExtension = async () => {
    if (!extSource.trim()) {
      onNotify('请输入扩展路径或 Chrome Web Store ID', true)
      return
    }
    setBusyId('ext-install')
    try {
      await api.manageExtensions({ action: 'install_extension', source: extSource.trim() })
      setExtSource('')
      setInstallExtOpen(false)
      await Promise.all([loadData(), onOverviewChanged()])
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '安装扩展失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const handleTeamLogin = async () => {
    setBusyId('team-login')
    try {
      const res = await api.teamLogin({
        serverUrl: serverUrl.trim(),
        email: email.trim(),
        password,
        totp: totp.trim() || undefined,
        rememberOrgKey,
      })
      if (res?.totpRequired) {
        onNotify('请输入二步验证 TOTP 动态码', true)
        return
      }
      setPassword('')
      setTotp('')
      setLoginOpen(false)
      await Promise.all([onOverviewChanged(), loadData()])
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '登录 Team Server 失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const handleTeamSignup = async () => {
    setBusyId('team-signup')
    try {
      await api.teamSignup({
        serverUrl: serverUrl.trim(),
        inviteToken: inviteToken.trim(),
        email: email.trim(),
        password,
        name: signupName.trim() || undefined,
      })
      setPassword('')
      setSignupOpen(false)
      await Promise.all([onOverviewChanged(), loadData()])
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '邀请注册失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const handleTeamUnlock = async () => {
    setBusyId('team-unlock')
    try {
      await api.teamUnlock(password)
      setPassword('')
      setUnlockOpen(false)
      await Promise.all([onOverviewChanged(), loadData()])
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '解锁组织根密钥失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const handleHandover = async () => {
    const target = teamMembers.find((m) => String(m.id) === handoverMemberId)
    if (!target || !target.public_key) {
      onNotify('请选择拥有有效公钥的成员', true)
      return
    }
    if (!handoverCodeInput.trim()) {
      onNotify('请输入线下核对后的 8 位公钥核验码', true)
      return
    }
    setBusyId('handover')
    try {
      await api.teamSync({
        action: 'handover_key',
        memberId: target.id,
        memberPublicKeyB64: target.public_key,
        expectedVerifyCode: handoverCodeInput.trim(),
      })
      setHandoverOpen(false)
      setHandoverCodeInput('')
      await loadData()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '密钥交接失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const handleOpenAudit = async (profileId) => {
    setBusyId('audit')
    try {
      const res = await api.teamSync({ action: 'audit_logs', profileId, limit: 50 })
      setAuditEvents(Array.isArray(res?.events) ? res.events : [])
      setAuditOpen(true)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '查询审计日志失败', true)
    } finally {
      setBusyId(null)
    }
  }

  const selectedHandoverMember = teamMembers.find((m) => String(m.id) === handoverMemberId)

  return (
    <>
      <div className="omnimux-pibrowse-two-col">
        <div className="omnimux-pibrowse-card">
          <div className="omnimux-pibrowse-card-head">
            <h2 className="omnimux-pibrowse-card-title">{t('extensionsTitle')}</h2>
            <Button
              variant="secondary"
              size="sm"
              disabled={!sidecarRunning}
              onClick={handlePickExtension}
            >
              {t('installExtension')}
            </Button>
          </div>
          {!sidecarRunning ? (
            <EmptyState compact title="启动 Sidecar 后管理浏览器扩展" />
          ) : extensions.length === 0 ? (
            <EmptyState compact title="尚未安装浏览器扩展" />
          ) : (
            <div className="omnimux-pibrowse-kv-list">
              {extensions.map((ext) => (
                <div key={ext.id || ext.name} className="omnimux-pibrowse-kv">
                  <span>
                    <strong>{ext.name || ext.id}</strong>{' '}
                    <span className="omnimux-pibrowse-muted">{ext.version || ext.kind || ''}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoveExtTarget(ext)}
                  >
                    {t('removeExtension')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="omnimux-pibrowse-card">
          <div className="omnimux-pibrowse-card-head">
            <h2 className="omnimux-pibrowse-card-title">{t('teamTitle')}</h2>
            {team.hasOrgKey ? (
              <Badge variant="success">已解锁 ORK</Badge>
            ) : team.pendingHandover ? (
              <Badge variant="warning">等待管理员交接密钥</Badge>
            ) : team.signedIn ? (
              <Badge variant="warning">ORK 已锁定</Badge>
            ) : (
              <Badge variant="neutral">未连接</Badge>
            )}
          </div>

          <div className="omnimux-pibrowse-kv-list">
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">服务器</span>
              <span className="omnimux-pibrowse-kv-v omnimux-pibrowse-mono">
                {team.configuredServerUrl || '未配置'}
              </span>
            </div>
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">当前成员</span>
              <span className="omnimux-pibrowse-kv-v">
                {team.email ? `${team.email} (${team.role || 'member'})` : '未登录'}
              </span>
            </div>
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">公钥核验码</span>
              <span className="omnimux-pibrowse-row">
                <span className="omnimux-pibrowse-mono">{team.verifyCode || '—'}</span>
                {team.verifyCode && (
                  <CopyButton
                    text={team.verifyCode}
                    size="xs"
                    onCopy={() => onNotify(t('copied'), false)}
                  />
                )}
              </span>
            </div>
            <div className="omnimux-pibrowse-kv">
              <span className="omnimux-pibrowse-kv-k">密钥代次</span>
              <span className="omnimux-pibrowse-kv-v omnimux-pibrowse-mono">
                {team.keyGeneration ? `gen ${team.keyGeneration}` : '—'}
              </span>
            </div>
          </div>

          <div className="omnimux-pibrowse-row">
            <Button variant="primary" size="sm" onClick={() => setLoginOpen(true)}>
              {t('teamLogin')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSignupOpen(true)}>
              {t('teamSignup')}
            </Button>
            {team.signedIn && !team.hasOrgKey && !team.pendingHandover && (
              <Button variant="secondary" size="sm" onClick={() => setUnlockOpen(true)}>
                {t('teamUnlock')}
              </Button>
            )}
            {team.hasOrgKey && (
              <>
                <Button variant="outline" size="sm" onClick={() => setHandoverOpen(true)}>
                  {t('teamHandover')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRotateConfirmOpen(true)}>
                  {t('teamRotateOrk')}
                </Button>
              </>
            )}
            {team.signedIn && (
              <Button variant="ghost" size="sm" onClick={() => setDisconnectConfirmOpen(true)}>
                {t('teamDisconnect')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {team.signedIn && (
        <div className="omnimux-pibrowse-card">
          <div className="omnimux-pibrowse-card-head">
            <div className="omnimux-pibrowse-row">
              <h2 className="omnimux-pibrowse-card-title">团队加密同步配置</h2>
              <Badge variant="neutral">项目 {teamProjects.length}</Badge>
              <Badge variant="neutral">成员 {teamMembers.length}</Badge>
            </div>
            <div className="omnimux-pibrowse-row">
              <Button variant="outline" size="sm" onClick={() => setProjectOpen(true)}>
                {t('teamCreateProject')}
              </Button>
              {team.hasOrgKey && sidecarRunning && (
                <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                  {t('teamShareLocal')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => handleOpenAudit(undefined)}>
                {t('teamAudit')}
              </Button>
            </div>
          </div>

          {teamProfiles.length === 0 ? (
            <EmptyState compact title="当前团队暂无已同步配置文件" />
          ) : (
            <div className="omnimux-pibrowse-table-wrap">
              <table className="omnimux-pibrowse-table">
                <thead>
                  <tr>
                    <th>团队配置</th>
                    <th>项目</th>
                    <th>分布式锁</th>
                    <th>代次</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {teamProfiles.map((tp) => {
                    const locked = Boolean(tp.locked_by || tp.lock_holder)
                    return (
                      <tr key={tp.id}>
                        <td><strong>{tp.name || tp.id}</strong></td>
                        <td>{tp.project_name || tp.project_id || '默认项目'}</td>
                        <td>
                          {locked ? (
                            <Badge variant="warning">已锁定（{tp.locked_by || tp.lock_holder}）</Badge>
                          ) : (
                            <Badge variant="success">空闲</Badge>
                          )}
                        </td>
                        <td className="omnimux-pibrowse-mono">gen {tp.key_generation || team.keyGeneration || 1}</td>
                        <td>
                          <div className="omnimux-pibrowse-row-nowrap">
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={!team.hasOrgKey}
                              loading={busyId === `launch:${tp.id}`}
                              onClick={async () => {
                                setBusyId(`launch:${tp.id}`)
                                try {
                                  await api.teamSync({
                                    action: 'launch_profile',
                                    profileId: tp.id,
                                    force: locked,
                                  })
                                  await Promise.all([loadData(), onOverviewChanged()])
                                } catch (err) {
                                  onNotify(err instanceof Error ? err.message : '加锁启动失败', true)
                                } finally {
                                  setBusyId(null)
                                }
                              }}
                            >
                              {locked ? t('teamForceTakeover') : t('teamLockLaunch')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenAudit(tp.id)}
                            >
                              {t('teamAudit')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ModalDialog
        open={installExtOpen}
        onClose={() => setInstallExtOpen(false)}
        title={t('installExtension')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setInstallExtOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'ext-install'} onClick={handleInstallExtension}>
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <InputField
          label="本地 .crx 扩展包路径或 32 位 Chrome Web Store ID"
          required
          value={extSource}
          onChange={(e) => setExtSource(e.target.value)}
        />
      </ModalDialog>

      <ModalDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        title={t('teamLogin')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setLoginOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'team-login'} onClick={handleTeamLogin}>
              {t('teamLogin')}
            </Button>
          </div>
        }
      >
        <div className="omnimux-pibrowse-field">
          <InputField label="Team Server URL" required value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://team.example.com" />
          <InputField label="邮箱" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <InputField label="主密码（本地 Argon2id 解锁私钥）" required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <InputField label="TOTP 二步验证码（可选）" value={totp} onChange={(e) => setTotp(e.target.value)} />
          <label className="omnimux-pibrowse-check-row">
            <input type="checkbox" checked={rememberOrgKey} onChange={(e) => setRememberOrgKey(e.target.checked)} />
            <span>在本地 0600 会话文件记住组织根密钥（ORK）</span>
          </label>
        </div>
      </ModalDialog>

      <ModalDialog
        open={signupOpen}
        onClose={() => setSignupOpen(false)}
        title={t('teamSignup')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setSignupOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'team-signup'} onClick={handleTeamSignup}>
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <div className="omnimux-pibrowse-field">
          <InputField label="Team Server URL" required value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
          <InputField label="邀请码（Invite Token）" required value={inviteToken} onChange={(e) => setInviteToken(e.target.value)} />
          <InputField label="邮箱" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <InputField label="昵称（可选）" value={signupName} onChange={(e) => setSignupName(e.target.value)} />
          <InputField label="设置主密码" required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </ModalDialog>

      <ModalDialog
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        title={t('teamUnlock')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setUnlockOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'team-unlock'} onClick={handleTeamUnlock}>
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <InputField label="输入主密码解锁本地 ORK" required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </ModalDialog>

      <ModalDialog
        open={handoverOpen}
        onClose={() => setHandoverOpen(false)}
        title="成员公钥核验与密钥交接"
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setHandoverOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" loading={busyId === 'handover'} onClick={handleHandover}>
              封装并下发 ORK
            </Button>
          </div>
        }
      >
        <div className="omnimux-pibrowse-field">
          <span className="omnimux-pibrowse-label">选择目标成员</span>
          <DropdownSelect
            aria-label="选择交接成员"
            value={handoverMemberId}
            options={teamMembers.map((m) => ({ value: String(m.id), label: `${m.email || m.id} (${m.verifyCode || '无公钥'})` }))}
            onChange={setHandoverMemberId}
          />
          {selectedHandoverMember?.verifyCode && (
            <div className="omnimux-pibrowse-verify-box">
              <span>{selectedHandoverMember.verifyCode}</span>
              <CopyButton
                text={selectedHandoverMember.verifyCode}
                size="sm"
                onCopy={() => onNotify(t('copied'), false)}
              />
            </div>
          )}
          <InputField
            label="再次输入线下核对的 8 位核验码"
            required
            value={handoverCodeInput}
            onChange={(e) => setHandoverCodeInput(e.target.value)}
            placeholder="XXXX-XXXX"
          />
        </div>
      </ModalDialog>

      <ModalDialog
        open={projectOpen}
        onClose={() => setProjectOpen(false)}
        title={t('teamCreateProject')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setProjectOpen(false)}>{t('cancel')}</Button>
            <Button
              variant="primary"
              loading={busyId === 'create-proj'}
              onClick={async () => {
                setBusyId('create-proj')
                try {
                  await api.teamSync({ action: 'create_project', name: projectName.trim() })
                  setProjectName('')
                  setProjectOpen(false)
                  await loadData()
                } catch (err) {
                  onNotify(err instanceof Error ? err.message : '创建项目失败', true)
                } finally {
                  setBusyId(null)
                }
              }}
            >
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <InputField label="项目名称" required value={projectName} onChange={(e) => setProjectName(e.target.value)} />
      </ModalDialog>

      <ModalDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={t('teamShareLocal')}
        footer={
          <div className="omnimux-pibrowse-row">
            <Button variant="outline" onClick={() => setShareOpen(false)}>{t('cancel')}</Button>
            <Button
              variant="primary"
              loading={busyId === 'share-local'}
              onClick={async () => {
                setBusyId('share-local')
                try {
                  await api.teamSync({
                    action: 'share_local_profile',
                    localProfileId: shareProfileId,
                    projectId: shareProjectId !== 'all' ? shareProjectId : undefined,
                  })
                  setShareOpen(false)
                  await loadData()
                } catch (err) {
                  onNotify(err instanceof Error ? err.message : '上传配置失败', true)
                } finally {
                  setBusyId(null)
                }
              }}
            >
              {t('confirm')}
            </Button>
          </div>
        }
      >
        <div className="omnimux-pibrowse-field">
          <span className="omnimux-pibrowse-label">本地配置</span>
          <DropdownSelect
            aria-label="选择本地配置"
            value={shareProfileId}
            options={localProfiles.map((p) => ({ value: String(p.id), label: p.name || p.id }))}
            onChange={setShareProfileId}
          />
          <span className="omnimux-pibrowse-label">目标团队项目</span>
          <DropdownSelect
            aria-label="选择目标团队项目"
            value={shareProjectId}
            options={[
              { value: 'all', label: t('allOption') },
              ...teamProjects.map((p) => ({ value: String(p.id), label: p.name || p.id })),
            ]}
            onChange={setShareProjectId}
          />
        </div>
      </ModalDialog>

      <ModalDialog
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title={t('teamAudit')}
        size="lg"
        footer={<Button variant="primary" onClick={() => setAuditOpen(false)}>{t('close')}</Button>}
      >
        <pre className="omnimux-pibrowse-log">{JSON.stringify(auditEvents, null, 2)}</pre>
      </ModalDialog>

      <ConfirmModal
        open={Boolean(removeExtTarget)}
        onClose={() => setRemoveExtTarget(null)}
        title="移除浏览器扩展"
        message={`确认移除扩展「${removeExtTarget?.name || removeExtTarget?.id || ''}」？`}
        confirmLabel={t('removeExtension')}
        cancelLabel={t('cancel')}
        confirmVariant="danger"
        confirmLoading={busyId === 'ext-remove'}
        onConfirm={async () => {
          const target = removeExtTarget
          if (!target) return
          setBusyId('ext-remove')
          try {
            await api.manageExtensions({ action: 'remove_extension', extensionId: target.id, confirm: true })
            setRemoveExtTarget(null)
            await Promise.all([loadData(), onOverviewChanged()])
          } catch (err) {
            onNotify(err instanceof Error ? err.message : '移除扩展失败', true)
          } finally {
            setBusyId(null)
          }
        }}
      />

      <ConfirmModal
        open={rotateConfirmOpen}
        onClose={() => setRotateConfirmOpen(false)}
        title="轮换组织根密钥（ORK）"
        message="将生成新一代 ORK 并重新封装所有成员密钥、代理 DEK、Cookie 密钥与分享包密钥，现有浏览器 Cookie 保持可用。"
        confirmLabel={t('teamRotateOrk')}
        cancelLabel={t('cancel')}
        confirmVariant="danger"
        confirmLoading={busyId === 'rotate-ork'}
        onConfirm={async () => {
          setBusyId('rotate-ork')
          try {
            await api.teamSync({ action: 'rotate_ork', confirm: true })
            setRotateConfirmOpen(false)
            await Promise.all([onOverviewChanged(), loadData()])
          } catch (err) {
            onNotify(err instanceof Error ? err.message : '轮换组织密钥失败', true)
          } finally {
            setBusyId(null)
          }
        }}
      />

      <ConfirmModal
        open={disconnectConfirmOpen}
        onClose={() => setDisconnectConfirmOpen(false)}
        title="断开 Team Server 连接"
        message="将注销当前会话并清除本地内存与 0600 会话文件中的 ORK 密钥。"
        confirmLabel={t('teamDisconnect')}
        cancelLabel={t('cancel')}
        confirmVariant="danger"
        confirmLoading={busyId === 'team-disconnect'}
        onConfirm={async () => {
          setBusyId('team-disconnect')
          try {
            await api.teamSync({ action: 'disconnect', confirm: true })
            setDisconnectConfirmOpen(false)
            await Promise.all([onOverviewChanged(), loadData()])
          } catch (err) {
            onNotify(err instanceof Error ? err.message : '断开连接失败', true)
          } finally {
            setBusyId(null)
          }
        }}
      />
    </>
  )
}
