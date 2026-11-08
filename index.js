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
const MAX_BODY_BYTES = 2 * 1024 * 1024

export const inject = ['llm', 'webServer']

export function apply(ctx) {
  const llm = ctx.get('llm')
  const webServer = ctx.get('webServer')
  if (llm === undefined) throw new Error('roleplay chat requires the llm service')
  if (webServer === undefined) throw new Error('roleplay chat requires the webServer service')
  const disposer = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      handle(ctx, req, res).catch((error) => {
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

async function handle(ctx, req, res) {
  const url = new URL(req.url ?? '/', 'http://x')
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin requests are refused' })
  if (req.method === 'GET' && url.pathname === PATH_MODEL) return handleModel(ctx, res)
  if (req.method === 'POST' && url.pathname === PATH_CHAT) return handleChat(ctx, req, res)
  return sendJson(res, 404, { error: 'not found' })
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
    if (options.length === 0 && fallback.provider && fallback.model) push(fallback.provider, fallback.model, fallback.model)
    sendJson(res, 200, { default: fallback, options })
  } catch (error) {
    sendJson(res, 500, { error: messageOf(error) })
  }
}

async function handleChat(ctx, req, res) {
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
  const system = typeof body?.system === 'string' ? body.system : ''
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
