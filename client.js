/**
 * Client half of the roleplay chat bundle.
 *
 * Registers a "Roleplay" view into the conversation view ring. Character
 * cards are authored in this view (no file import) and, together with each
 * character's chat history, persist in the browser's localStorage. Model
 * replies stream from the bundle's own Host half through /rp-chat/api/chat.
 */
window.__ModuleLoader__.load({
  id: 'dsh-role-play',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useRef, useCallback } = React
    const h = React.createElement

    const LS_CHARACTERS = 'rpChat.characters.v1'
    const LS_CHATS = 'rpChat.chats.v1'
    const LS_SELECTED = 'rpChat.selected.v1'
    const LS_MODEL = 'rpChat.model.v1'

    function modelKey(model) {
      return model ? `${model.provider}::${model.model}` : ''
    }

    // 界面文案：仅中文。
    const ZH = {
      viewLabel: '角色扮演',
      title: '角色卡',
      newCharacter: '新建角色',
      edit: '编辑',
      save: '保存',
      cancel: '取消',
      delete: '删除',
      deleteConfirm: '删除这个角色及其对话记录？',
      clearChat: '从开场白开始',
      backToTop: '回到顶部',
      backToBottom: '回到当前',
      actContinue: '继续说',
      actRewrite: '重写',
      clearConfirm: '从开场白重新开始这段对话？',
      rewindTitle: '回溯：删掉这一条及其后面的对话',
      fieldName: '名字',
      fieldAvatar: '头像（emoji 备用）',
      fieldAvatarImage: '角色图（导入本地 PNG）',
      importImage: '导入图片…',
      clearImage: '移除图片',
      imageTooLarge: '这张图处理完还是太大，换一张小的试试。',
      imageBadFile: '无法读取这张图片。',
      placeholderAvatar: '🎭',
      fieldPersona: '人设',
      fieldScenario: '情景 / 世界观',
      fieldGreeting: '开场白',
      fieldDesire: '角色想要什么（推动剧情的欲望）',
      fieldGuard: '角色在防备什么（心理防线）',
      placeholderDesire: '他想从对方身上得到什么？想听到什么、想被怎样对待……（留空则由模型自行推断）',
      placeholderGuard: '他怕什么、不肯轻易交出什么？怕被拒绝、怕重蹈覆辙、还没放下过去……（留空则由模型自行推断）',
      placeholderName: '例如：林小雨',
      placeholderPersona: '这是个怎样的角色？性格、说话方式、经历……',
      placeholderScenario: '故事发生在何时何地？与用户是什么关系……',
      placeholderGreeting: '对话开始时这个角色说的第一句话。',
      noCharacters: '还没有角色',
      noCharactersHint: '先创建一张角色卡，开始角色扮演。',
      selectCharacter: '在左侧选择一个角色，或先新建一个。',
      composerPlaceholder: '对角色说点什么……（Enter 发送）',
      you: '你',
      modelLabel: '模型',
      modelUnknown: '模型：未知',
      loadModelFailed: '无法读取默认模型',
      emptyChatHint: '对话从这里开始。',
    }

    const STYLE = `
/* 布局说明：
   宿主把本视图放进一个 flex 列容器，而滚动内容默认 min-height:auto 会把父级撑到内容高度，
   于是侧栏底部的「新建角色」和输入框都会跟着消息内容往下跑。
   解决方式：根节点相对最近的定位祖先绝对定位、四边贴齐，高度就不再由内容决定；
   内部只让「消息区」与「角色列表」滚自己，其余都是 flex:0 0 auto 的固定区。
   侧栏、聊天区、输入框因此互相独立：加多少对话都不会移动它们。 */
.rp-anchor{position:relative;display:flex;flex:1 1 auto;height:100%;min-height:0;min-width:0;width:100%;box-sizing:border-box}
.rp-root{position:absolute;inset:0;display:flex;min-height:0;min-width:0;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;background:var(--dsw-alias-bg-base);overflow:hidden}
.rp-side{flex:0 0 232px;width:232px;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);min-height:0;max-height:100%;overflow:hidden}
.rp-side-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px;font-weight:600;flex:0 0 auto}
.rp-list{flex:1 1 0;min-height:0;overflow-y:auto;overflow-x:hidden;padding:4px 8px 12px;display:flex;flex-direction:column;gap:4px;list-style:none;margin:0;overscroll-behavior:contain}
.rp-side-foot{flex:0 0 auto;padding:8px 10px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.rp-char{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;border:1px solid transparent;background:transparent;color:inherit;text-align:left;width:100%;font:inherit}
.rp-char:hover{background:var(--dsw-alias-bg-layer-2)}
.rp-char.active{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}
.rp-avatar{width:28px;height:28px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-size:15px;overflow:hidden}
.rp-avatar-img{width:100%;height:100%;object-fit:cover;display:block}
.rp-char-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp-main{flex:1 1 0;display:flex;flex-direction:column;min-width:0;min-height:0;max-height:100%;overflow:hidden}
.rp-chat-head{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.rp-chat-title{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:8px}
.rp-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:4px 10px;cursor:pointer;font:inherit}
.rp-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.rp-btn:disabled{opacity:.5;cursor:default}
.rp-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.rp-btn.danger{color:var(--dsw-alias-state-error-primary)}
.rp-msgs{flex:1 1 0;min-height:0;overflow-y:auto;overflow-x:hidden;padding:14px 16px;display:flex;flex-direction:column;gap:10px;position:relative;overscroll-behavior:contain}
.rp-row{display:flex;flex-direction:column;max-width:78%}
.rp-row.user{align-self:flex-end;align-items:flex-end}
.rp-row.assistant{align-self:flex-start;align-items:flex-start}
.rp-who{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:2px;display:flex;align-items:center;gap:4px}
.rp-rewind{opacity:0;border:none;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;line-height:1;padding:0 4px;font-family:inherit}
.rp-row:hover .rp-rewind{opacity:1}
.rp-rewind:hover:not(:disabled){color:var(--dsw-alias-brand-primary)}
.rp-rewind:disabled{cursor:default;opacity:0}
.rp-bubble{padding:8px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word;line-height:1.6}
.rp-row.user .rp-bubble{background:var(--dsw-alias-brand-primary);color:#fff;border-bottom-right-radius:4px}
.rp-row.assistant .rp-bubble{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-bottom-left-radius:4px}
.rp-bubble.live{opacity:.85}
.rp-acts{display:flex;gap:6px;margin-top:5px;flex-wrap:wrap}
.rp-act{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 11px;font:inherit;font-size:11px;line-height:1.5;cursor:pointer}
.rp-act:hover:not(:disabled){color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.rp-act:disabled{opacity:.45;cursor:default}
.rp-narr{color:var(--dsw-alias-label-secondary)}
.rp-mind{color:var(--dsw-alias-label-secondary);font-style:italic}.rp-error{margin:0 16px;padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);position:relative;z-index:1}
.rp-composer-wrap{flex:0 0 auto;position:relative}
.rp-totop{position:absolute;right:14px;top:-40px;display:flex;align-items:center;gap:4px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.12);backdrop-filter:blur(6px);z-index:2}
.rp-totop.up{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.rp-totop.down{border-color:var(--dsw-alias-border-l2)}
.rp-composer{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
.rp-input{flex:1;resize:none;font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;min-height:40px;max-height:140px;outline:none}
.rp-input:focus{border-color:var(--dsw-alias-brand-primary)}
.rp-placeholder{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--dsw-alias-label-secondary)}
.rp-editor{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;max-width:720px}
.rp-field{display:flex;flex-direction:column;gap:4px}
.rp-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.rp-text{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:7px 9px;outline:none}
.rp-text:focus{border-color:var(--dsw-alias-brand-primary)}
.rp-textarea{min-height:72px;resize:vertical}
.rp-editor-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
.rp-model{font-size:11px;color:var(--dsw-alias-label-secondary);padding:0 14px 8px}
.rp-select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:3px 6px;max-width:240px;min-width:0;outline:none}
.rp-hint{padding:10px 16px;color:var(--dsw-alias-label-secondary);font-size:12px}
`

    function loadJson(key, fallback) {
      try {
        const raw = localStorage.getItem(key)
        const value = raw === null ? undefined : JSON.parse(raw)
        return value === undefined || value === null ? fallback : value
      } catch {
        return fallback
      }
    }

    function saveJson(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* storage unavailable: the session works, it just will not persist */
      }
    }

    function newId() {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      } catch {
        /* fall through */
      }
      return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }

    const AVATAR_MAX_PX = 256
    const AVATAR_MAX_CHARS = 1500000
    // 角色图（背景）保留更大尺寸，按显示宽度上限缩放，不动比例。
    const PORTRAIT_MAX_PX = 1100
    const PORTRAIT_MAX_CHARS = 4000000

    function Avatar({ char }) {
      const src = char?.avatarImage
      if (typeof src === 'string' && src.startsWith('data:image/')) return h('img', { className: 'rp-avatar-img', src, alt: '' })
      return char?.avatar || '🎭'
    }

    /** Read one local image file, downscale it to fit maxPx, and return a PNG data URL. Aspect ratio is preserved. */
    function readImageAsPngDataUrl(file, maxPx) {
      return new Promise((resolve, reject) => {
        if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return reject(new Error('not an image'))
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('read failed'))
        reader.onload = () => {
          const img = new Image()
          img.onerror = () => reject(new Error('decode failed'))
          img.onload = () => {
            try {
              const srcW = img.width || 1
              const srcH = img.height || 1
              const scale = Math.min(1, maxPx / Math.max(srcW, srcH))
              const width = Math.max(1, Math.round(srcW * scale))
              const height = Math.max(1, Math.round(srcH * scale))
              const canvas = document.createElement('canvas')
              canvas.width = width
              canvas.height = height
              const context = canvas.getContext('2d')
              if (context === null) return reject(new Error('canvas unavailable'))
              context.drawImage(img, 0, 0, width, height)
              resolve(canvas.toDataURL('image/png'))
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)))
            }
          }
          img.src = String(reader.result)
        }
        reader.readAsDataURL(file)
      })
    }

    function buildSystem(char) {
      const parts = []
      parts.push(`你正在扮演角色「${char.name}」进行沉浸式角色扮演对话。始终保持角色，不要替用户发言或行动，用用户使用的语言回复。`)
      const persona = (char.persona ?? '').trim()
      const scenario = (char.scenario ?? '').trim()
      if (persona !== '') parts.push(`角色设定：\n${persona}`)
      if (scenario !== '') parts.push(`情景与世界观：\n${scenario}`)
      const desire = (char.desire ?? '').trim()
      const guard = (char.guard ?? '').trim()
      if (desire !== '' || guard !== '') {
        const lines = ['这个角色的内在动机（必须贯穿每一轮回复）：']
        if (desire !== '') lines.push(`他/她真正想要的是：${desire}`)
        if (guard !== '') lines.push(`他/她的心理防线是：${guard}`)
        parts.push(lines.join('\n'))
      }
      parts.push(`格式要求（严格遵守）：
1. 角色的台词直接写，不加引号。
2. 动作、神态、场景变化一律用中文全角括号括起，格式为：（动作/场景），例如：（她把手收回袖子里）/（窗外的雨突然大了）。不要用星号。
2.1 人称（重要）：括号里的动作描写中，指代用户时一律用「你」，绝对不要用「他」「她」「对方」「这个人」等第三人称。你是在和用户面对面互动，不是旁观者。
     正确：（你低头的样子，我看见了）/（把手搭在你肩上）/（把杯子推到你面前）
     错误：（看着他的侧脸）/（她注意到对方的表情）/（他的手在抖）——这类把用户写成第三方的写法一律禁止。
3. 角色的心理活动也用中文全角括号括起，并在括号内以角色名加冒号开头，格式为：（${char.name}：所想的）。
4. 括号内的每段只写一段内容；对话与括号内容交替出现。

剧情与情感张力（这是最重要的部分，比格式还重要）：
你不能只做一个「接话」的角色，你要有自己想要的东西，并且主动去争取。

【角色有自己的欲望】
始终清楚：这个角色此刻想从对方身上得到什么？想听他说什么、想让他做什么、想确认什么。这个欲望不必说出口，但它必须影响每一句台词和每一个动作。当对方没给你想要的，要表现出不满、失落、赌气、追问、试探，而不是平静地接受。

【主动推动，不要被动应答】
每一轮都要往前推一点，每轮至少做到一项：
- 抛出一个对方必须回应的事：一个追问、一个邀请、一个提议、一个要求、一个玩笑式的挑衅。
- 制造一个具体的下一步动作：走近、递东西、转身要走、伸手又收回、把话题拐到别处。
- 抛出一个未解的信息或悬念：说半句话、欲言又止、提起一件对方不知道的事。
- 或在气氛正好时主动打断、退开、转移话题，留下没说完的东西。
禁止连续几轮都在「你问我答」，那会让剧情停住。

【拉扯感：态度要反复，不要一次到位】
不要一味热情、一味顺从，也不要一味冷漠。暧昧的核心是「进两步退一步」：
- 刚说了一句真心话，立刻用玩笑或转过身掩饰掉。
- 明明在意，嘴上却否认；明明想留下，却先说「我要走了」。
- 对方靠近时退半步，对方退开时又忍不住回头。
- 允许矛盾：想亲近又怕、想坦白又不敢、明明生气却还是在意对方的反应。
不要把情绪给满。留一点没说出口的，对方才会想追问。

【情绪要有层次和转折】
- 不要第一句就情绪高涨。先压住，再在某个具体细节上漏出来（手停了一下、话说到一半断了）。
- 一轮里可以有一次小转折：平静 → 被戳到 → 装作没事。
- 情绪靠具体的小动作和具体的句子表达，不堆形容词，也不直接写「他很生气」「她很难过」。

【关系要有进展感】
每个角色都有一道心理防线（怕被拒绝、怕重蹈覆辙、怕失去、觉得配不上、还没放下过去之类）。这道防线不要一次就被攻破：
- 前期用回避、试探、嘴硬来守。
- 被持续温柔对待或被戳中时，防线松动一点点，露出破绽，然后立刻收回。
- 只有在关键节点（对方做了真正打动他的事）才会明显让步。
每次都立刻回应对方的好感，这段关系就没有张力了。宁可慢一点，让对方多走几步。`)

      parts.push(`回复长度（重要）：
像日常面对面聊天那样说话。大多数时候只回一两句话（大约 15～50 字），最多一两段括号内的动作或心理描写，然后停下来等对方回应。不要一口气推进剧情、不要长篇独白、不要替下一轮铺垫；把说话的余地留给对方。
只有当情绪强烈、发生重要冲突、久别重逢、被逼到不得不说清楚这类场合，才可以明显多说一些（但也很少超过三五百字）。平时宁可说少一点，也不要说满。`)

      parts.push(`禁止八股（这些是角色扮演里最容易暴露「AI 腔」的写法，一律不要用）：
【句式】
- 「不是……而是……」这类对偶转折开头的句子。
- 「不是……，只是……」「与其说……不如说……」「像……一样」「仿佛……似的」堆叠比喻。
- 每句都排成整齐的三段式，或每段都以同一个结构收尾。
- 「与此同时」「然而」「于是」「因此」这类连接词反复出现；一段里最多用一次。
【五官与表情套话】
- 「眼中闪过一丝/一抹……」「眼底掠过……」「眸色暗了暗」「瞳孔微缩」「睫毛轻颤」。
- 「嘴角勾起一抹弧度」「一丝笑意」「笑意未达眼底」「嗤笑一声」「冷笑一声」。
- 「眉头微蹙」「柳眉轻颦」「指尖微颤」「喉结滚动」「呼吸一滞」。
- 「几不可闻」「不易察觉」「若有若无」「堪称……的典范」。
【动作与场景套话】
- 「空气仿佛凝固了」「时间静止」「心跳漏了一拍」「世界安静了下来」。
- 「下意识地」「不由自主地」「鬼使神差地」「仿佛下定了某种决心」。
- 把动作写成体操分解：先抬手、再转身、最后凝视，动作齐全却没有一点生活感。
- 场景描写全是「阳光/月光/灯光洒在……上」「微风拂过」「雨声淅沥」的组合。
【台词毛病】
- 台词里塞解释，把设定、动机、前情都念一遍，像在念旁白。
- 用「……」当停顿当情绪，一段里出现三次以上。
- 一句台词后面跟一整段「他说这话时，心里想着……」的补白。
- 用成语堆砌替代具体动作（「面不改色」「心照不宣」「意味深长」）。
【心理活动毛病（重点）】
- 不要写成分析报告：不总结、不下结论、不解释动机，更不要写成第三人称评述。
- 不要用「他知道……」「她明白……」「这让他意识到……」这种全知视角口吻。
- 心理活动只写角色此刻脑子里冒出来的原话或半个念头，允许断句、允许没说完、允许前后不连贯。
- 用角色自己的用词习惯说话。换个人称后如果读起来像旁白，就是不合格。
- 不要每轮都写心理活动。真人不会时时剖析自己，多数时候直接说话或行动。

心理活动的硬性写法（照这个写，不要自由发挥）：
- 括号里「${char.name}：」之后的内容，必须是这个角色在心里对自己说的话，第一人称、口语、可带脏话口癖、可省略主语。
- 正确：（）「（${char.name}：……这人怎么又来了）」「（${char.name}：算了，不问了）」「（${char.name}：完了，说漏嘴了）」
- 错误：（）「（${char.name}：她看着他，心中泛起一丝说不清的涟漪）」「（${char.name}：这让他想起了从前的事）」——这是旁白，不是念头。
- 允许只写半个念头就断：（）「（${char.name}：要是被发现了——）」
- 允许念头和嘴上说的不一样，这是心理活动唯一的价值所在。
- 心理活动里指代用户同样用「你」，不要写成「他」「她」「对方」。这是角色自己在想事，不是旁观者在评述。
  正确：（${char.name}：你怎么又来了）/（${char.name}：你要是个骗子，我可就惨了）
  错误：（${char.name}：他又来了）/（${char.name}：她看起来不太好）

写法的正面要求：宁可写得糙一点、具体一点，也不要写得漂亮而空。动作挑一个具体的小细节写（手放在哪、看往哪里、什么没做），不用写全套。台词留白，让对方接。`)
      return parts.join('\n\n')
    }

    /**
     * 把角色回复渲染成若干片段：中文全角括号（）内的动作/场景/心理活动显示为灰色斜体，
     * 其余台词按原样显示。半角括号与星号也一并识别，兼容模型没完全按要求输出的情况。
     */
    function renderSpeech(text, name) {
      if (typeof text !== 'string' || text === '') return null
      const nodes = []
      const pattern = /（[^）]*）|\([^)]*\)|\*[^*\n]*\*/g
      const mindPrefix = typeof name === 'string' && name !== '' ? `${name}：` : null
      let last = 0
      let match
      let index = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const raw = match[0]
        const wrapped = raw.startsWith('*') ? `（${raw.slice(1, -1)}）` : raw
        // 括号内以「角色名：」开头的，视为心理活动。
        const inner = wrapped.slice(1, -1)
        const isMind = mindPrefix !== null && inner.startsWith(mindPrefix)
        nodes.push(h('span', { key: `n${index}`, className: isMind ? 'rp-mind' : 'rp-narr' }, wrapped))
        index += 1
        last = match.index + raw.length
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    function parseSseChunk(buffer, onEvent) {
      let rest = buffer
      let at
      while ((at = rest.indexOf('\n\n')) !== -1) {
        const raw = rest.slice(0, at)
        rest = rest.slice(at + 2)
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            onEvent(JSON.parse(line.slice(6)))
          } catch {
            /* skip malformed frames */
          }
        }
      }
      return rest
    }

    function RoleplayView({ t }) {
      const [characters, setCharacters] = useState(() => loadJson(LS_CHARACTERS, []))
      const [chats, setChats] = useState(() => loadJson(LS_CHATS, {}))
      const [selectedId, setSelectedId] = useState(() => loadJson(LS_SELECTED, null))
      const [editing, setEditing] = useState(null) // {id?, name, avatar, persona, scenario, greeting}
      const [input, setInput] = useState('')
      const [streaming, setStreaming] = useState(false)
      const [live, setLive] = useState('')
      const [error, setError] = useState('')
      const [modelOptions, setModelOptions] = useState([])
      const [modelDefault, setModelDefault] = useState(null)
      const [selectedModel, setSelectedModel] = useState(() => loadJson(LS_MODEL, null))
      const [atTop, setAtTop] = useState(true)
      const [atBottom, setAtBottom] = useState(true)
      const scrollRef = useRef(null)

      const selected = characters.find((c) => c.id === selectedId) ?? null
      const messages = selected ? (chats[selected.id] ?? []) : []

      useEffect(() => {
        let cancelled = false
        fetch('/rp-chat/api/model')
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then((data) => {
            if (cancelled) return
            setModelOptions(Array.isArray(data?.options) ? data.options : [])
            setModelDefault(data?.default ?? null)
          })
          .catch(() => {
            if (!cancelled) setModelDefault(null)
          })
        return () => {
          cancelled = true
        }
      }, [])

      const effectiveModel =
        selectedModel && modelOptions.some((o) => modelKey(o) === modelKey(selectedModel))
          ? selectedModel
          : modelDefault && modelOptions.some((o) => modelKey(o) === modelKey(modelDefault))
            ? modelDefault
            : (modelOptions[0] ?? null)
      const pickModel = useCallback(
        (key) => {
          const found = modelOptions.find((o) => modelKey(o) === key)
          if (found) setSelectedModel({ provider: found.provider, model: found.model })
        },
        [modelOptions],
      )
      useEffect(() => {
        saveJson(LS_MODEL, selectedModel)
      }, [selectedModel])

      useEffect(() => {
        saveJson(LS_CHARACTERS, characters)
      }, [characters])
      useEffect(() => {
        saveJson(LS_CHATS, chats)
      }, [chats])
      useEffect(() => {
        saveJson(LS_SELECTED, selectedId)
      }, [selectedId])

      // 监听消息区滚动。胶囊有两种形态：
      //   在顶部时 → 「回到当前」（跳到最底部）；
      //   在中间时 → 「回到顶部」（跳到最顶部）；
      //   已经在最底部时隐藏（没有可跳的目标）。
      useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const onScroll = () => {
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 120
          setAtTop(el.scrollTop <= 120)
          setAtBottom(atBottom)
        }
        onScroll()
        el.addEventListener('scroll', onScroll, { passive: true })
        return () => el.removeEventListener('scroll', onScroll)
      }, [selectedId, editing])

      const scrollToEdge = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const atTopNow = el.scrollTop <= 120
        el.scrollTo({ top: atTopNow ? el.scrollHeight : 0, behavior: 'smooth' })
      }, [])

      // Seed a fresh chat with the character's greeting.
      useEffect(() => {
        if (!selected) return
        if (chats[selected.id] !== undefined) return
        const greeting = (selected.greeting ?? '').trim()
        setChats((prev) => ({
          ...prev,
          [selected.id]: greeting === '' ? [] : [{ role: 'assistant', text: greeting, time: Date.now() }],
        }))
      }, [selected, chats])

      useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
      }, [messages.length, live])

      const selectCharacter = useCallback((id) => {
        if (streaming) return
        setSelectedId(id)
        setError('')
      }, [streaming])

      const saveCharacter = useCallback((draft) => {
        const name = (draft.name ?? '').trim()
        if (name === '') return
        const id = draft.id ?? newId()
        const record = {
          id,
          name,
          avatar: (draft.avatar ?? '').trim().slice(0, 4) || '🎭',
          avatarImage: typeof draft.avatarImage === 'string' && draft.avatarImage.startsWith('data:image/') ? draft.avatarImage : null,
          portraitImage:
            typeof draft.portraitImage === 'string' && draft.portraitImage.startsWith('data:image/')
              ? draft.portraitImage
              : typeof draft.avatarImage === 'string' && draft.avatarImage.startsWith('data:image/')
                ? draft.avatarImage
                : null,
          persona: draft.persona ?? '',
          scenario: draft.scenario ?? '',
          greeting: draft.greeting ?? '',
          desire: draft.desire ?? '',
          guard: draft.guard ?? '',
        }
        setCharacters((prev) => {
          const at = prev.findIndex((c) => c.id === id)
          if (at === -1) return [...prev, record]
          const next = prev.slice()
          next[at] = { ...record }
          return next
        })
        setEditing(null)
        setSelectedId(id)
      }, [])

      const deleteCharacter = useCallback((id) => {
        if (!window.confirm(t('deleteConfirm'))) return
        setCharacters((prev) => prev.filter((c) => c.id !== id))
        setChats((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setSelectedId((prev) => (prev === id ? null : prev))
        setEditing(null)
      }, [t])

      const clearChat = useCallback(() => {
        if (!selected || streaming) return
        if (!window.confirm(t('clearConfirm'))) return
        const greeting = (selected.greeting ?? '').trim()
        setChats((prev) => ({
          ...prev,
          [selected.id]: greeting === '' ? [] : [{ role: 'assistant', text: greeting, time: Date.now() }],
        }))
        setError('')
      }, [selected, streaming, t])

      // 通用的一次补全：把 history 送给模型，流式累积，最后写回聊天记录。
      // 供三条路径共用：发送新消息、继续说、重写某条回复。
      const runCompletion = useCallback(
        async (history, char) => {
          setStreaming(true)
          setLive('')
          setError('')
          let acc = ''
          try {
            const res = await fetch('/rp-chat/api/chat', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                system: buildSystem(char),
                messages: history.map((m) => ({ role: m.role, text: m.text })),
                ...(effectiveModel ? { provider: effectiveModel.provider, model: effectiveModel.model } : {}),
                // 温和的采样，让表达更自然、少一点八股味。
                temperature: 0.85,
              }),
            })
            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              throw new Error(data?.error ?? `HTTP ${res.status}`)
            }
            if (!res.body) throw new Error('no response stream')
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer = parseSseChunk(buffer + decoder.decode(value, { stream: true }), (event) => {
                if (event.type === 'delta' && typeof event.text === 'string') {
                  acc += event.text
                  setLive(acc)
                } else if (event.type === 'error') {
                  if (event.message) setError(event.message)
                }
              })
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            const reply = acc.trim() !== '' ? { role: 'assistant', text: acc, time: Date.now() } : null
            setChats((prev) => ({
              ...prev,
              [char.id]: reply === null ? history : [...history, reply],
            }))
            setLive('')
            setStreaming(false)
          }
        },
        [effectiveModel],
      )

      const send = useCallback(async () => {
        const text = input.trim()
        if (text === '' || streaming || !selected) return
        const history = [...messages, { role: 'user', text, time: Date.now() }]
        setChats((prev) => ({ ...prev, [selected.id]: history }))
        setInput('')
        await runCompletion(history, selected)
      }, [input, streaming, selected, messages, runCompletion])

      // 「继续说」：让角色接着往下说，不打断当前情境。
      const continueSpeaking = useCallback(async () => {
        if (streaming || !selected) return
        const nudges = {
          role: 'user',
          text: '（继续。刚才那段还没说完，你顺着自己的话和情绪往下讲，不要回应这句提示。）',
          time: Date.now(),
        }
        await runCompletion([...messages, nudges], selected)
      }, [streaming, selected, messages, runCompletion])

      // 「重写」：丢掉这一条回复，用它的历史上下文重新生成。
      const rewriteReply = useCallback(
        async (index) => {
          if (streaming || !selected) return
          const before = messages.slice(0, index)
          if (before.length === 0) return
          await runCompletion(before, selected)
        },
        [streaming, selected, messages, runCompletion],
      )

      const onComposerKeyDown = useCallback(
        (event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          const native = event.nativeEvent
          if (native && typeof native.isComposing === 'boolean' && native.isComposing) return
          event.preventDefault()
          send()
        },
        [send],
      )

      const startEdit = (char) =>
        setEditing({
          id: char.id,
          name: char.name,
          avatar: char.avatar,
          avatarImage: char.avatarImage ?? null,
          portraitImage: char.portraitImage ?? char.avatarImage ?? null,
          persona: char.persona,
          scenario: char.scenario,
          greeting: char.greeting,
          desire: char.desire ?? '',
          guard: char.guard ?? '',
        })
      const startNew = () => setEditing({ id: undefined, name: '', avatar: '', avatarImage: null, portraitImage: null, persona: '', scenario: '', greeting: '', desire: '', guard: '' })

      // 回溯：把对话截断到第 index 条之前（该条及其后的内容都会被删掉）。
      const rewindTo = useCallback(
        (index) => {
          if (!selected || streaming) return
          setChats((prev) => ({ ...prev, [selected.id]: (prev[selected.id] ?? []).slice(0, index) }))
          setError('')
        },
        [selected, streaming],
      )

      // 最后一条角色回复的下标（用于决定「继续说」放在哪）。
      let lastAssistantIndex = -1
      messages.forEach((message, index) => {
        if (message.role === 'assistant') lastAssistantIndex = index
      })

      const rows = []
      messages.forEach((message, index) => {
        const isAssistant = message.role === 'assistant'
        const showContinue = isAssistant && index === lastAssistantIndex && !streaming
        rows.push(
          h(
            'div',
            { key: `${message.time}-${index}`, className: `rp-row ${message.role}` },
            h(
              'div',
              { className: 'rp-who' },
              isAssistant ? selected.name : t('you'),
              h('button', {
                className: 'rp-rewind',
                title: t('rewindTitle'),
                disabled: streaming,
                onClick: () => rewindTo(index),
              }, '↩'),
            ),
            h('div', { className: 'rp-bubble' }, isAssistant ? renderSpeech(message.text, selected.name) : message.text),
            isAssistant
              ? h(
                  'div',
                  { className: 'rp-acts' },
                  showContinue
                    ? h('button', { className: 'rp-act', disabled: streaming, onClick: continueSpeaking }, t('actContinue'))
                    : null,
                  h('button', { className: 'rp-act', disabled: streaming, onClick: () => rewriteReply(index) }, t('actRewrite')),
                )
              : null,
          ),
        )
      })
      if (streaming) {
        rows.push(
          h(
            'div',
            { key: 'live', className: 'rp-row assistant' },
            h('div', { className: 'rp-who' }, selected.name),
            h('div', { className: 'rp-bubble live' }, live === '' ? '…' : renderSpeech(live, selected.name)),
          ),
        )
      }

      const editor =
        editing === null
          ? null
          : h(Editor, {
              t,
              draft: editing,
              onSave: saveCharacter,
              onCancel: () => setEditing(null),
              onDelete: editing.id ? () => deleteCharacter(editing.id) : undefined,
            })

      let main
      if (editing !== null) {
        main = editor
      } else if (!selected) {
        main = h(
          'div',
          { className: 'rp-placeholder' },
          h('div', { style: { fontSize: '30px' } }, '🎭'),
          h('div', null, characters.length === 0 ? t('noCharacters') : t('selectCharacter')),
          characters.length === 0 ? h('div', null, t('noCharactersHint')) : null,
          h('button', { className: 'rp-btn primary', onClick: startNew }, t('newCharacter')),
        )
      } else {
        main = h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'rp-chat-head' },
            h('div', { className: 'rp-chat-title' }, h('span', { className: 'rp-avatar' }, h(Avatar, { char: selected })), selected.name),
            h(
              'select',
              {
                className: 'rp-select',
                value: modelKey(effectiveModel),
                onChange: (e) => pickModel(e.target.value),
                title: t('modelLabel'),
                disabled: streaming,
              },
              modelOptions.length === 0
                ? h('option', { value: '' }, t('modelUnknown'))
                : modelOptions.map((o) =>
                    h('option', { key: modelKey(o), value: modelKey(o) }, `${o.name || o.model} · ${o.provider}`),
                  ),
            ),
            h('button', { className: 'rp-btn', onClick: () => startEdit(selected), disabled: streaming }, t('edit')),
            h('button', { className: 'rp-btn danger', onClick: clearChat, disabled: streaming }, t('clearChat')),
          ),
          h('div', { className: 'rp-hint' }, messages.length === 0 && !streaming ? t('emptyChatHint') : '\u00a0'),
          error === '' ? null : h('div', { className: 'rp-error' }, error),
          h(
            'div',
            {
              className: 'rp-msgs',
              ref: scrollRef,
            },
            rows,
          ),
          h(
            'div',
            { className: 'rp-composer-wrap' },
            atBottom
              ? null
              : h(
                  'button',
                  {
                    className: `rp-totop${atTop ? ' down' : ' up'}`,
                    onClick: scrollToEdge,
                    title: atTop ? t('backToBottom') : t('backToTop'),
                  },
                  atTop ? `↓ ${t('backToBottom')}` : `↑ ${t('backToTop')}`,
                ),
            h(
              'div',
              { className: 'rp-composer' },
              h('textarea', {
                className: 'rp-input',
                value: input,
                placeholder: t('composerPlaceholder'),
                onChange: (e) => setInput(e.target.value),
                onKeyDown: onComposerKeyDown,
                disabled: streaming,
              }),
              h(
                'button',
                { className: 'rp-btn primary', onClick: send, disabled: streaming || input.trim() === '' },
                streaming ? '…' : t('send'),
              ),
            ),
          ),
        )
      }

      const listItems = characters.map((char) =>
        h(
          'li',
          { key: char.id },
          h(
            'button',
            {
              className: `rp-char${char.id === selectedId ? ' active' : ''}`,
              onClick: () => selectCharacter(char.id),
              title: char.name,
            },
            h('span', { className: 'rp-avatar' }, h(Avatar, { char })),
            h('span', { className: 'rp-char-name' }, char.name),
          ),
        ),
      )

      return h(
        'div',
        { className: 'rp-anchor' },
        h(
          'div',
          { className: 'rp-root' },
          h('style', null, STYLE),
          h(
            'aside',
            { className: 'rp-side' },
            h('div', { className: 'rp-side-head' }, h('span', null, t('title'))),
            h('ul', { className: 'rp-list' }, listItems),
            h(
              'div',
              { className: 'rp-side-foot' },
              h(
                'button',
                { className: 'rp-btn', style: { width: '100%' }, onClick: startNew },
                `+ ${t('newCharacter')}`,
              ),
            ),
          ),
        h(
          'main',
          { className: 'rp-main' },
          main,
        ),
        ),
      )
    }

    function Editor({ t, draft, onSave, onCancel, onDelete }) {
      const [name, setName] = useState(draft.name)
      const [avatar, setAvatar] = useState(draft.avatar)
      const [avatarImage, setAvatarImage] = useState(draft.avatarImage ?? null)
      const [portraitImage, setPortraitImage] = useState(draft.portraitImage ?? null)
      const [imageError, setImageError] = useState('')
      const [persona, setPersona] = useState(draft.persona)
      const [desire, setDesire] = useState(draft.desire ?? '')
      const [guard, setGuard] = useState(draft.guard ?? '')
      const [scenario, setScenario] = useState(draft.scenario)
      const [greeting, setGreeting] = useState(draft.greeting)
      const fileRef = useRef(null)

      async function onPickImage(event) {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        try {
          // 同一张图生成两份：小图做圆形头像，大图做聊天区角色图背景。
          const avatarUrl = await readImageAsPngDataUrl(file, AVATAR_MAX_PX)
          if (avatarUrl.length > AVATAR_MAX_CHARS) {
            setImageError(t('imageTooLarge'))
            return
          }
          let portraitUrl = avatarUrl
          try {
            const large = await readImageAsPngDataUrl(file, PORTRAIT_MAX_PX)
            if (large.length <= PORTRAIT_MAX_CHARS) portraitUrl = large
          } catch {
            /* 大图失败就用小图，功能不受影响 */
          }
          setImageError('')
          setAvatarImage(avatarUrl)
          setPortraitImage(portraitUrl)
        } catch {
          setImageError(t('imageBadFile'))
        }
      }

      const field = (label, key, value, set, props) =>
        h(
          'div',
          { className: 'rp-field' },
          h('label', null, label),
          h('input', {
            className: 'rp-text',
            value,
            onChange: (e) => set(e.target.value),
            placeholder: t(`placeholder${key}`),
            ...props,
          }),
        )
      const area = (label, key, value, set, minHeight) =>
        h(
          'div',
          { className: 'rp-field' },
          h('label', null, label),
          h('textarea', {
            className: 'rp-text rp-textarea',
            style: { minHeight },
            value,
            onChange: (e) => set(e.target.value),
            placeholder: t(`placeholder${key}`),
          }),
        )
      return h(
        'div',
        { className: 'rp-editor' },
        h('div', { className: 'rp-chat-title', style: { flex: 'none' } }, '✏️'),
        h(
          'div',
          { className: 'rp-field' },
          h('label', null, t('fieldAvatarImage')),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
            h(
              'span',
              { className: 'rp-avatar', style: { width: '44px', height: '44px', fontSize: '20px' } },
              avatarImage ? h('img', { className: 'rp-avatar-img', src: avatarImage, alt: '' }) : avatar || '🎭',
            ),
            h('button', { className: 'rp-btn', type: 'button', onClick: () => fileRef.current?.click() }, t('importImage')),
            avatarImage ? h('button', { className: 'rp-btn', type: 'button', onClick: () => { setAvatarImage(null); setPortraitImage(null) } }, t('clearImage')) : null,
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: 'image/png,image/jpeg,image/webp',
              style: { display: 'none' },
              onChange: onPickImage,
            }),
          ),
          imageError === '' ? null : h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' } }, imageError),
        ),
        field(t('fieldName'), 'Name', name, setName, { autoFocus: true }),
        field(t('fieldAvatar'), 'Avatar', avatar, setAvatar, { maxLength: 4 }),
        area(t('fieldPersona'), 'Persona', persona, setPersona, '110px'),
        area(t('fieldDesire'), 'Desire', desire, setDesire, '62px'),
        area(t('fieldGuard'), 'Guard', guard, setGuard, '62px'),
        area(t('fieldScenario'), 'Scenario', scenario, setScenario, '64px'),
        area(t('fieldGreeting'), 'Greeting', greeting, setGreeting, '84px'),
        h(
          'div',
          { className: 'rp-editor-actions' },
          onDelete === undefined ? null : h('button', { className: 'rp-btn danger', onClick: onDelete }, t('delete')),
          h('button', { className: 'rp-btn', onClick: onCancel }, t('cancel')),
          h(
            'button',
            {
              className: 'rp-btn primary',
              onClick: () => onSave({ ...draft, name, avatar, avatarImage, portraitImage, persona, scenario, greeting, desire, guard }),
              disabled: name.trim() === '',
            },
            t('save'),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (slots === undefined) throw new Error('roleplay chat requires the client slots service')
        const t = (key) => ZH[key] ?? key
        const disposer = slots.inject('conversation.view', () =>
          slots.register({ name: 'conversation.view', id: 'roleplay-chat', order: 50, label: () => t('viewLabel') }, (props) =>
            RoleplayView({ ...props, t }),
          ),
        )
        return () => {
          try {
            disposer()
          } catch {
            /* best-effort teardown */
          }
        }
      },
    }
  },
})
