import type { Context } from '@deepseek-ai/cordis'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { TextGenerationRequest } from './protocol.ts'

/**
 * Apply a validated route to this temporary Agent's prompt and requests.
 * The desktop's session.selectModel also persists the deployment default,
 * which a one-shot Copilot override must leave alone.
 */
export async function bindTextSessionModel(ctx: Context, request: TextGenerationRequest): Promise<() => void> {
  const id = request.sessionId as Parameters<AgentRegistry['get']>[0]
  const agent = ctx.agents.get(id)
  if (!agent) throw new Error(`session/not-found: ${request.sessionId}`)
  const llm = ctx.get('llm')
  if (!llm) throw new Error('Host model registry unavailable')
  const models = await llm.listModels(request.provider)
  if (!models.some((entry) => entry.id === request.model)) {
    throw new Error(`Model unavailable: ${request.provider}/${request.model}`)
  }
  const { provider, model, reasoningEffort } = await llm.resolveCallConfig({
    provider: request.provider,
    model: request.model,
    ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }),
  })
  if (ctx.agents.get(id) !== agent) throw new Error(`session/not-found: ${request.sessionId}`)

  // The session controller installs its own waterfall on this Agent. Wrap
  // its result so the one-shot selection wins without changing its default.
  const stopAssembly = agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    return { ...assembly, variables: { ...assembly.variables, provider, model } }
  }, { prepend: true })
  const stopRequest = agent.ctx.on('agent/request', async (_request, next) => {
    const { reasoningEffort: _inherited, ...config } = await next()
    return { ...config, provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }
  }, { prepend: true })
  return () => {
    stopRequest()
    stopAssembly()
  }
}
