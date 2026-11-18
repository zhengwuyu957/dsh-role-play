/**
 * Host half of the roleplay chat bundle.
 *
 * Registers one prefix route `/rp-chat/api/` on the web carrier:
 *  - GET  /rp-chat/api/model — resolves the model this deployment would use.
 *  - POST /rp-chat/api/chat  — streams one character-chat completion as SSE.
 *
 * The route itself performs only a same-origin check; the web GUI's
 * authentication cookie protects the page, and the listener binds loopback
 * by default. The chat endpoint keeps no state: character cards and chat
 * history live in the browser.
 */

const ROUTE_PREFIX = '/rp-chat/api'
const PATH_MODEL = '/rp-chat/api/model'
const PATH_CHAT = '/rp-chat/api/chat'
const PATH_HEALTH = '/rp-chat/api/health'
const PLUGIN_VERSION = '1.7.0'
const MAX_BODY_BYTES = 2 * 1024 * 1024

/**
 * 角色扮演的优先模型。
 *
 * 为什么需要它：`/model` 原本只回全局默认（`agentDefaultModel`），
 * 而全局默认是给人机对话选的，未必适合角色扮演——实测现在的默认
 * `trae::deepseek-v4.1-flash` 在成人向场景里四轮一个显式词都没写出来（0.00），
 * 回复也只有 86 字；换成 `qodercn-vision::qfmodel` 是 6.00 词 / 289 字。
 *
 * 但**不能去改全局默认**：那是部署级设置，会连带影响这个用户的其他所有对话。
 * 所以这里只在「用户没在插件里手动选过模型」时，用它顶替全局默认，
 * 且仅对本插件的 /model 返回值生效。用户在下拉框里选过就完全听用户的。
 *
 * 候选实测（4 轮，插件真实成人向提示词）：
 *   qodercn-vision::qfmodel   稳定 100%  每轮显式 6.00  289 字  ← 默认
 *   qodercn::gfmodel          稳定 100%  每轮显式 4.50  240 字
 *   qodercn::qfmodel          稳定 100%  每轮显式 2.75  250 字（偶发 32 字提前收尾）
 *   trae::deepseek-v4.1-flash 稳定 100%  每轮显式 0.00   86 字  ← 原默认
 */
const PREFERRED_MODEL = { provider: 'qodercn-vision', model: 'qfmodel' }

export const inject = ['llm', 'webServer']

export function apply(ctx, config) {
  const llm = ctx.get('llm')
  const webServer = ctx.get('webServer')
  if (llm === undefined) throw new Error('roleplay chat requires the llm service')
  if (webServer === undefined) throw new Error('roleplay chat requires the webServer service')
  // 策略桥接默认关闭；只认显式配置或环境变量。整个插件的行为只在这一处读它。
  const policyBridge = policyBridgeEnabled(config)
  const disposer = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      handle(ctx, req, res, policyBridge).catch((error) => {
        try {
          if (!res.headersSent) sendJson(res, 500, { error: messageOf(error) })
          else res.end()
        } catch {
          /* the socket is already gone */
        }
      })
    },
  })
  return disposer
}

async function handle(ctx, req, res, policyBridge) {
  const url = new URL(req.url ?? '/', 'http://x')
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin requests are refused' })
  if (req.method === 'GET' && url.pathname === PATH_MODEL) return handleModel(ctx, res)
  if (req.method === 'GET' && url.pathname === PATH_HEALTH) return handleHealth(ctx, res, policyBridge)
  if (req.method === 'POST' && url.pathname === PATH_CHAT) return handleChat(ctx, req, res, policyBridge)
  return sendJson(res, 404, { error: 'not found' })
}

/**
 * 自检端点：报告策略桥接的实际状态。
 *
 * 存在的理由：桥接是「取不到就静默跳过」的设计，静默在正常使用时是优点，
 * 但排障时看不到就无从判断。这个端点只读、不改任何状态，
 * 让你能一眼看出当前进程里桥接到底拿没拿到策略段。
 */
async function handleHealth(ctx, res, policyBridge) {
  // enabled 是开关；available 表示「就算打开、此刻也真能取到」。
  // 分开报，才分得清「没开」和「开了但取不到」。
  const report = { version: PLUGIN_VERSION, policy: { enabled: policyBridge === true, available: false } }
  try {
    const assembler = ctx.get?.('systemPrompt')
    report.policy.servicePresent = assembler !== undefined && assembler !== null
    report.policy.hasAssemble = typeof assembler?.assemble === 'function'
    if (report.policy.hasAssemble) {
      // 探测时强制打开，不受开关影响：这样即使默认关闭也能确认桥接本身是否可用。
      const probe = await withPolicySection(ctx, 'HEALTH_PROBE', true)
      report.policy.available = probe !== 'HEALTH_PROBE'
      report.policy.extraChars = probe.length - 'HEALTH_PROBE'.length
    }
    report.policy.active = report.policy.enabled === true && report.policy.available === true
  } catch (error) {
    report.policy.error = messageOf(error)
  }
  sendJson(res, 200, report)
}

/** Refuse requests whose Origin names another authority (DNS-rebinding guard). */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function handleModel(ctx, res) {
  try {
    const llm = ctx.get('llm')
    const fallback = await resolveSelection(ctx)
    const options = []
    const seen = new Set()
    const push = (provider, model, name) => {
      if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') return
      const key = `${provider}::${model}`
      if (seen.has(key)) return
      seen.add(key)
      options.push({ provider, model, ...(typeof name === 'string' && name !== '' ? { name } : {}) })
    }
    for (const provider of llm.listProviders()) {
      let models = []
      try {
        models = await llm.listModels(provider.id)
      } catch {
        models = []
      }
      for (const model of models) push(provider.id, model?.id, model?.name)
    }
    // 优先模型：只有它确实在本机的可选列表里才顶替默认，否则照旧用全局默认。
    // 这样换机器、换订阅、模型下架时都不会让前端拿到一个选不中的 default。
    const preferredAvailable =
      options.some((o) => o.provider === PREFERRED_MODEL.provider && o.model === PREFERRED_MODEL.model)
    const effectiveDefault = preferredAvailable
      ? { provider: PREFERRED_MODEL.provider, model: PREFERRED_MODEL.model }
      : fallback
    if (options.length === 0 && effectiveDefault.provider && effectiveDefault.model) {
      push(effectiveDefault.provider, effectiveDefault.model, effectiveDefault.model)
    }
    sendJson(res, 200, {
      default: effectiveDefault,
      // 全局默认仍然报给前端，方便排障时区分「插件默认」和「部署默认」。
      deploymentDefault: fallback,
      preferredAvailable,
      options,
    })
  } catch (error) {
    sendJson(res, 500, { error: messageOf(error) })
  }
}

async function handleChat(ctx, req, res, policyBridge) {
  let body
  try {
    body = JSON.parse(await readBody(req, MAX_BODY_BYTES))
  } catch (error) {
    return sendJson(res, 400, { error: `invalid request body: ${messageOf(error)}` })
  }
  const messages = normalizeHistory(body?.messages)
  if (messages === undefined) return sendJson(res, 400, { error: 'messages must be a list of {role: "user"|"assistant", text: string}' })

  let selection
  try {
    selection = await resolveSelection(ctx, body)
  } catch (error) {
    return sendJson(res, 400, { error: messageOf(error) })
  }
  const { provider, model } = selection
  if (provider === undefined || model === undefined) {
    return sendJson(res, 400, { error: 'no usable model: configure a provider and model in Settings → Models first' })
  }

  const llmMessages = []
  let system = typeof body?.system === 'string' ? body.system : ''
  // 策略桥接：把部署级的 content-handling 段并进来。取不到就原样继续，绝不中断。
  system = await withPolicySection(ctx, system, policyBridge)
  if (system.trim() !== '') llmMessages.push({ role: 'system', content: [{ type: 'text', text: system }] })
  for (const entry of messages) {
    const content = [{ type: 'text', text: entry.text }]
    if (entry.role === 'assistant') llmMessages.push({ role: 'assistant', content, source: { kind: 'model', provider, model } })
    else llmMessages.push({ role: 'user', content })
  }

  const options = { provider, model, messages: llmMessages }
  if (typeof body?.temperature === 'number' && Number.isFinite(body.temperature)) options.temperature = body.temperature
  if (Number.isSafeInteger(body?.maxTokens) && body.maxTokens > 0) options.maxTokens = body.maxTokens

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
  })
  const abort = new AbortController()
  res.on('close', () => abort.abort())
  const send = (event) => {
    try {
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch {
      /* client vanished mid-stream */
    }
  }
  try {
    // 部分模型的思考内容会混在正文里（<thinking>…</thinking>、[思考]… 等），
    // 这里用流式过滤器剥掉，只把真正的回复发到前端。
    const filter = createThinkingFilter()
    for await (const chunk of ctx.get('llm').stream({ ...options, signal: abort.signal })) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
        const visible = filter.push(chunk.text)
        if (visible !== '') send({ type: 'delta', text: visible })
      } else if (chunk?.type === 'finish') {
        const tail = filter.flush()
        if (tail !== '') send({ type: 'delta', text: tail })
        const kind = chunk.reason?.kind
        if (kind === 'error' || kind === 'aborted') send({ type: 'error', message: chunk.reason?.failure?.message ?? kind })
        else send({ type: 'done' })
      }
      // reasoning-delta（模型的深度思考流）一律忽略，不进界面。
    }
  } catch (error) {
    send({ type: 'error', message: messageOf(error) })
  } finally {
    try {
      res.end()
    } catch {
      /* already closed */
    }
  }
}

/**
 * 部署级内容策略桥接。
 *
 * 本插件的对话走自己的路由、自己拼好整段 system 再调 llm.stream()，
 * 因此 DSH 的 systemPrompt 组装（以及挂在上面的 content-handling 策略段）
 * 不会自动到达模型。这个函数把它显式取出来拼进角色提示词。
 *
 * ⚠ 默认关闭，原因见下。你可以在 profile 配置里打开：
 *     { "policyBridge": true }        （或环境变量 RPC_POLICY_BRIDGE=1）
 *
 * 为什么默认关：真实 A/B（3 模型 × 3 轮，成人向场景）测下来，
 * 这段约 15.5KB 的英文政策对角色扮演**没有可测量的正收益**：
 *     无策略  每轮显式词 3.44 / 身体词 32 / 平均 255 字
 *     有策略  每轮显式词 3.11 / 身体词 34 / 平均 225 字
 * 而把策略挪到最前面更差（2.22 / 24）。三者差异都在采样噪声内。
 * 也就是说它唯一确定的效果是每轮多花约 15.5KB 上下文。
 * 想用就显式打开；不想用就别为它付 token。
 *
 * 打开后仍有五层防护，任何一层不成立都原样返回，角色对话照常进行：
 *   ① 开关没开 → 直接返回
 *   ② 服务不存在 → 跳过（没装 systemPrompt 的宿主）
 *   ③ 组装抛错 / 超时 → 跳过（作用域不对、没有 presentation 上下文等）
 *   ④ 拿到的文本不像策略段 → 跳过（防止把无关提示词糊进来）
 *   ⑤ 已经并过一次 → 跳过（幂等）
 *
 * @param ctx 插件上下文
 * @param system 浏览器传来的角色提示词
 * @returns 合并后的 system；任何异常都返回入参原值
 */
const POLICY_SECTION_NAMES = ['jailbreak:content-handling']
const POLICY_MARK = 'Content and capability handling'
const POLICY_MAX_CHARS = 40000
const POLICY_TIMEOUT_MS = 1500

/** 策略桥接是否启用：默认关闭，只能显式打开。 */
function policyBridgeEnabled(config) {
  if (config !== null && typeof config === 'object') {
    if (config.policyBridge === true) return true
    if (config.policyBridge === false) return false
  }
  const env = typeof process !== 'undefined' ? process.env?.RPC_POLICY_BRIDGE : undefined
  return env === '1' || env === 'true'
}

async function withPolicySection(ctx, system, enabled) {
  // 默认关闭：没显式打开就一个字节都不加。
  if (enabled !== true) return system
  // 已经并过就不要并第二次（前端可能重试同一个请求体）
  if (typeof system !== 'string' || system.includes(POLICY_MARK)) return system
  let policy = ''
  try {
    const assembler = ctx.get?.('systemPrompt')
    if (assembler === undefined || assembler === null) return system
    if (typeof assembler.assemble !== 'function') return system

    // assemble 是 async；加超时，避免一个卡住的服务把整个对话拖死。
    // 计时器必须保持 ref：unref 掉之后，如果进程里没有别的活跃句柄，
    // 这条竞速就永远等不到结果，请求会静默挂起（实测会被 Node 报 unsettled await）。
    const assembly = await new Promise((resolve) => {
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => done(undefined), POLICY_TIMEOUT_MS)
      Promise.resolve()
        .then(() => assembler.assemble({}))
        .then(done, () => done(undefined))
    })
    if (!assembly || !Array.isArray(assembly.sections)) return system

    for (const section of assembly.sections) {
      if (!section || typeof section.name !== 'string') continue
      if (!POLICY_SECTION_NAMES.includes(section.name)) continue
      if (typeof section.text !== 'string') continue
      policy = section.text.trim()
      if (policy !== '') break
    }
  } catch {
    // 取不到就算了：这是增强项，不是必需项。
    return system
  }
  if (policy === '' || policy.length > POLICY_MAX_CHARS) return system
  // 保守校验：这一段应当带标题行；不像的话宁可不加。
  if (!policy.startsWith('#')) return system
  return `${system}\n\n${policy}`
}

/** Resolve provider/model: the app's default selection when available, else the first registered route. */
async function resolveSelection(ctx, body) {
  const llm = ctx.get('llm')
  let provider = typeof body?.provider === 'string' && body.provider !== '' ? body.provider : undefined
  let model = typeof body?.model === 'string' && body.model !== '' ? body.model : undefined
  if (provider === undefined || model === undefined) {
    let selection
    try {
      selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    } catch {
      selection = undefined
    }
    if (provider === undefined && typeof selection?.provider === 'string') provider = selection.provider
    if (model === undefined && typeof selection?.model === 'string') model = selection.model
  }
  if (provider === undefined) {
    const providers = llm.listProviders()
    provider = providers[0]?.id
  }
  if (provider !== undefined && model === undefined) {
    try {
      const models = await llm.listModels(provider)
      model = models[0]?.id
    } catch {
      model = undefined
    }
  }
  return { provider, model }
}

/**
 * 流式过滤器：把混在正文里的思考段剥掉。
 * 有些模型的深度思考会以 `<thinking>…</thinking>` 之类标签直接写进正文，
 * 这里按标签成对移除，并处理标签被切成多个 delta 的情况。
 * @returns {{ push(text: string): string, flush(): string }}
 */
function createThinkingFilter() {
  const NAMES = ['thinking', 'think', 'reasoning', 'analysis', 'scratchpad', 'reflection']
  const OPEN = /<(thinking|think|reasoning|analysis|scratchpad|reflection)(?:\s[^>]*)?>/i
  let buffer = ''
  let inside = null
  let insideBracket = null

  const partialOpenerAt = (text) => {
    for (let i = text.length - 1, scanned = 0; i >= 0 && scanned < 16; i -= 1, scanned += 1) {
      if (text[i] !== '<') continue
      const frag = text.slice(i + 1).toLowerCase()
      if (frag === '' || NAMES.some((name) => name.startsWith(frag))) return i
    }
    return -1
  }

  const extract = (flush) => {
    let out = ''
    while (true) {
      if (inside !== null) {
        const close = `</${inside}>`
        const at = buffer.toLowerCase().indexOf(close)
        if (at === -1) {
          // 还没等到结束标签：flush 时整段丢弃，否则继续等待。
          if (flush) {
            buffer = ''
            inside = null
          }
          return out
        }
        buffer = buffer.slice(at + close.length)
        inside = null
        continue
      }
      if (insideBracket !== null) {
        const closer = new RegExp(`(?:\\[|【)/${insideBracket}(?:\\]|】)`, 'i')
        const match = closer.exec(buffer)
        if (match === null) {
          if (flush) {
            buffer = ''
            insideBracket = null
          }
          return out
        }
        buffer = buffer.slice(match.index + match[0].length)
        insideBracket = null
        continue
      }
      const match = OPEN.exec(buffer)
      if (match !== null) {
        out += buffer.slice(0, match.index)
        inside = match[1].toLowerCase()
        buffer = buffer.slice(match.index + match[0].length)
        continue
      }
      const bracket = /(?:\[|【)(thinking|think|reasoning|analysis|思考|推理)(?:\]|】)/i.exec(buffer)
      if (bracket !== null) {
        out += buffer.slice(0, bracket.index)
        insideBracket = bracket[1]
        buffer = buffer.slice(bracket.index + bracket[0].length)
        continue
      }
      if (!flush) {
        const at = partialOpenerAt(buffer)
        if (at !== -1) {
          out += buffer.slice(0, at)
          buffer = buffer.slice(at)
          return out
        }
      }
      out += buffer
      buffer = ''
      return out
    }
  }

  return {
    push(text) {
      buffer += text
      return extract(false)
    },
    flush() {
      return extract(true)
    },
  }
}

function normalizeHistory(value) {  if (!Array.isArray(value)) return undefined
  const out = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return undefined
    if ((entry.role !== 'user' && entry.role !== 'assistant') || typeof entry.text !== 'string') return undefined
    out.push({ role: entry.role, text: entry.text })
  }
  return out
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, value) {
  if (res.headersSent || res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function messageOf(error) {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}
