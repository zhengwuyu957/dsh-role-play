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
    const LS_MODE = 'rpChat.dialogueMode.v1'
    const LS_MAX = 'rpChat.maxTension.v1'
    const LS_MEMORY = 'rpChat.memory.v1'
    const LS_STATUS = 'rpChat.status.v1'
    // 每个角色对「用户是谁」的认知：姓名、性格、性别。
    const LS_PROFILE = 'rpChat.userProfile.v1'

    /** 与子插件共享的运行时快照，由 RoleplayView 在状态变化时同步。 */
    const SHARED = {
      characters: [],
      model: null,
      listeners: new Set(),
      // 外部写入计数：子插件建卡后自增，挂载中的界面据此重新拉取。
      version: 0,
    }

    /**
     * 直接把角色卡落盘并刷新共享快照。
     * 放在模块级是关键：子插件可能在本视图从未被打开过时就要建卡，
     * 那时组件没挂载，任何依赖 useState 的写法都会失败。
     */
    function persistCharacters(cards) {
      const next = Array.isArray(cards) ? cards : []
      saveJson(LS_CHARACTERS, next)
      SHARED.characters = next.slice()
      SHARED.version += 1
      publishShared()
    }

    /**
     * 新增一张角色卡（供子插件调用）。重名时拒绝，保证幂等。
     * @returns {{id: string, name: string} | null}
     */
    function addCharacterCard(card) {
      const name = typeof card?.name === 'string' ? card.name.trim() : ''
      if (name === '') return null
      const current = loadJson(LS_CHARACTERS, [])
      if (!Array.isArray(current)) return null
      if (current.some((c) => c?.name === name)) return null
      const record = {
        id: newId(),
        name,
        avatar: (card?.avatar ?? '').trim().slice(0, 4) || '🎭',
        avatarImage: null,
        portraitImage: null,
        gender: normalizeGender(card?.gender),
        persona: card?.persona ?? '',
        scenario: card?.scenario ?? '',
        greeting: card?.greeting ?? '',
        desire: card?.desire ?? '',
        guard: card?.guard ?? '',
      }
      persistCharacters([...current, record])
      return record
    }
    /**
     * 把各种写法的性别收敛成三个值：'男' | '女' | ''（未指定）。
     * 模型和用户都可能写成 male/female/男性/女性，这里统一。
     */
    function normalizeGender(raw) {
      if (typeof raw !== 'string') return ''
      const v = raw.trim().toLowerCase()
      if (v === '') return ''
      if (/^(男|男性|男的|male|m|man|boy)$/.test(v)) return '男'
      if (/^(女|女性|女的|female|f|woman|girl)$/.test(v)) return '女'
      // 兼容「男性，35岁」这种带修饰的写法
      if (/男/.test(v)) return '男'
      if (/女/.test(v)) return '女'
      return ''
    }

    function publishShared() {
      for (const fn of SHARED.listeners) {
        try {
          fn()
        } catch {
          /* 子插件的监听器出错不应影响主插件 */
        }
      }
    }
    // 模块加载时就把磁盘上的角色卡读进快照：子插件可能先于本视图被打开，
    // 那时成员列表不能是空的。
    try {
      const initial = loadJson(LS_CHARACTERS, [])
      if (Array.isArray(initial)) SHARED.characters = initial.slice()
    } catch {
      /* 读不到就让界面首次渲染时自己填 */
    }

    // 滚动摘要参数：最近这么多条原文保留，更早的部分压缩成「前情提要」。
    const KEEP_RECENT_MESSAGES = 24
    // 摘要最多保留多少字，超出时让模型再压一次。
    const SUMMARY_MAX_CHARS = 900

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
      dialogueMode: '对话模式',
      modeLong: '长对话',
      modeMedium: '适中',
      modeShort: '简短',
      modeLongDesc: '回复更充分，氛围铺得更开',
      modeMediumDesc: '既有内容，又不会说太多',
      modeShortDesc: '一两句话就停，留白更多',
      maxTensionLabel: '加强',
      maxTensionDesc: '张力MAX',
      memoryLabel: '记忆',
      memoryAuto: '自动记忆已启动：对话变长后，早期的内容会被压缩成前情提要，角色仍然记得住。',
      memoryActive: '已有前情提要，早期对话已压缩保存。',
      memoryCleared: '已清空该角色的记忆。',
      memoryClear: '清空记忆',
      memoryClearConfirm: '清空这个角色的前情提要？聊天记录不受影响，但角色会忘掉早期剧情。',
      memoryView: '查看记忆',
      memoryViewTitle: '角色的记忆',
      memoryEmpty: '还没有记忆。聊得久一些（未压缩消息超过 24 条）后，早期对话会自动压缩成前情提要。',
      memoryCount: '已压缩',
      memoryCountUnit: '条消息',
      memoryClose: '关闭',
      statusLabel: '状态',
      statusPanelTitle: '角色状态',
      statusPanelHint: '由角色在对话中体现，会自动更新',
      statusEmpty: '还没有状态。聊几轮后，角色的情绪和处境会自动记录下来。',
      statusUpdated: '上次更新',
      statusRefresh: '重新评估',
      statusClear: '清空状态',
      statusClearConfirm: '清空这个角色的状态记录？',
      statusMood: '情绪',
      statusScene: '场景',
      statusRelation: '对你的态度',
      statusPending: '正在分析…',
      createTitle: '添加角色',
      createCustom: '自定义',
      createCustomDesc: '自己填写全部内容',
      createRandom: '关键词生成',
      createRandomDesc: '给几个关键词，让 AI 生成完整角色卡（角色图需自行导入）',
      createKeywords: '关键词',
      createKeywordsPlaceholder: '例如：雨夜、外科医生、嘴硬心软、旧伤',
      createKeywordsHint: '用顿号或逗号分隔，2～6 个词效果最好。生成后角色图需自行导入。',
      createGenerate: '生成',
      createGenerating: '正在生成角色…',
      createFailed: '生成失败，请检查模型是否可用后重试。',
      createTooShort: '至少填一个关键词。',
      memoryTip: '长期对话建议保留开启，角色不会因为记录变长而失忆。',
      panelTitle: '对话模式',
      panelHint: '回复长度与情绪强度',
      clearConfirm: '从开场白重新开始这段对话？',
      rewindTitle: '回溯：删掉这一条及其后面的对话',
      fieldName: '名字',
      fieldAvatar: '头像（emoji 备用）',
      fieldGender: '性别',
      genderUnset: '未指定',
      genderMale: '男',
      genderFemale: '女',
      genderHint: '这个角色自己的性别。填了之后，叙述里会用正确的「他」或「她」指代角色。',
      profileLabel: '对你的认知',
      profileTitle: '对你的认知',
      profileHint: '眼里的你是什么样子，只影响这个角色',
      profileName: '你的名字',
      profileNamePlaceholder: '角色怎么称呼你',
      profileGender: '你的性别',
      profileGenderHint: '留空则跟随角色卡上的性别',
      profilePersona: '你在他眼里的样子',
      profilePersonaPlaceholder: '例如：话不多但很敏锐的人，总是先替别人着想，讨厌被同情',
      profileClear: '清空',
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
.rp-modebar{display:flex;align-items:center;gap:6px;padding:6px 14px 0;flex-wrap:wrap}.rp-modecapsule{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:3px 12px;font:inherit;font-size:11px;line-height:1.5;cursor:pointer}
.rp-modecapsule:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.rp-modecapsule.on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.rp-modecapsule .dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:none}
.rp-panel{position:absolute;right:14px;bottom:calc(100% - 42px);width:236px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:12px;z-index:3}
.rp-panel-title{font-weight:600;font-size:12px;margin-bottom:2px}
.rp-panel-hint{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:10px}
.rp-mode-list{display:flex;flex-direction:column;gap:4px}
.rp-mode-item{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:7px 9px;border-radius:8px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;font:inherit;text-align:left;width:100%}
.rp-mode-item:hover{background:var(--dsw-alias-bg-layer-2)}
.rp-mode-item.active{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary)}
.rp-mode-item b{font-size:12px;font-weight:600}
.rp-mode-item span{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rp-panel-div{margin:10px 0 8px;border-top:1px solid var(--dsw-alias-border-l1)}
.rp-mem-panel{width:248px}
.rp-status-list{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
.rp-status-row{display:flex;gap:8px;align-items:baseline;font-size:12px;line-height:1.5}
.rp-status-row b{flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-weight:400;font-size:11px}
.rp-status-row span{flex:1;min-width:0;color:var(--dsw-alias-label-primary)}
.rp-create-choices{display:flex;flex-direction:column;gap:8px}
.rp-create-choice{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:12px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer;font:inherit;text-align:left;width:100%}
.rp-create-choice:hover{border-color:var(--dsw-alias-brand-primary)}
.rp-create-choice b{font-size:13px;font-weight:600}
.rp-create-choice span{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rp-mem-meta-inline{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:8px;padding:5px 8px;background:var(--dsw-alias-bg-layer-2);border-radius:6px}
.rp-mem-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.rp-mem-overlay{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:50;padding:24px}
.rp-mem-modal{width:min(560px,100%);max-height:min(70vh,600px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden}
.rp-mem-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.rp-mem-head-title{font-weight:600;font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp-mem-meta{font-size:11px;color:var(--dsw-alias-label-secondary);padding:8px 16px 0;flex:0 0 auto}
.rp-mem-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 16px 16px;font-size:13px;line-height:1.75;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary);overscroll-behavior:contain}
.rp-mem-empty{color:var(--dsw-alias-label-secondary)}
.rp-mem-foot{flex:0 0 auto;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;justify-content:flex-end;gap:8px}
.rp-max{padding-top:2px}
.rp-max-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:4px 14px;font:inherit;font-size:12px;cursor:pointer}
.rp-max-btn:hover{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.rp-max-btn.on{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:#fff}
.rp-max-hint{margin-top:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.rp-totop{position:absolute;right:14px;top:-40px;display:flex;align-items:center;gap:4px;padding:5px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.12);backdrop-filter:blur(6px);z-index:2}
.rp-totop.up{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.rp-totop.down{border-color:var(--dsw-alias-border-l2)}
.rp-composer{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
.rp-input{flex:1;resize:none;font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;min-height:40px;max-height:140px;outline:none}
.rp-input:focus{border-color:var(--dsw-alias-brand-primary)}
.rp-placeholder{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--dsw-alias-label-secondary)}
.rp-editor{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;max-width:720px}
.rp-field{display:flex;flex-direction:column;gap:4px}
.rp-gender{display:flex;gap:6px}
.rp-gender-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:7px;padding:4px 14px;font:inherit;font-size:12px;cursor:pointer}
.rp-gender-btn:hover{border-color:var(--dsw-alias-border-l2)}
.rp-gender-btn.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.rp-profile-field{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
.rp-profile-field label{font-size:11px;color:var(--dsw-alias-label-secondary)}
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

    /**
     * 把一段对话压缩成「前情提要」。用较低温度让摘要稳定、不发挥。
     * @param messages 要压缩的消息（role/text）
     * @param previousSummary 已有的摘要，会一并再压缩
     * @returns 摘要文本；失败时返回 null（调用方保留原摘要，不丢数据）
     */
    async function summarizeMessages(messages, previousSummary, model) {
      const transcript = messages
        .map((m) => `${m.role === 'user' ? '用户' : '角色'}：${m.text}`)
        .join('\n')
      const prompt = `${previousSummary ? `【已有前情提要】\n${previousSummary}\n\n` : ''}【接下来这段对话需要并入前情】
${transcript}

请把以上内容（连同已有前情，如果有）压缩成一段不超过 ${SUMMARY_MAX_CHARS} 字的前情提要，供角色扮演时参考。要求：
1. 只写事实和关系变化：发生了什么、双方说了什么要紧的话、关系进展到哪一步、角色表现出什么态度。
2. 保留具体细节：提到的物品、地点、称呼、承诺、未解决的矛盾。
3. 用第三人称陈述，不要写成对话，不要加点评和抒情。
4. 不要遗漏尚未解决的情感线。`
      try {
        const res = await fetch('/rp-chat/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            system: '你是一个对话摘要助手。只输出摘要正文，不要任何前缀、解释或客套。',
            messages: [{ role: 'user', text: prompt }],
            ...(model ? { provider: model.provider, model: model.model } : {}),
            temperature: 0.2,
            maxTokens: 900,
          }),
        })
        if (!res.ok || !res.body) return null
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let acc = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer = parseSseChunk(buffer + decoder.decode(value, { stream: true }), (event) => {
            if (event.type === 'delta' && typeof event.text === 'string') acc += event.text
          })
        }
        const text = acc.trim()
        return text === '' ? null : text
      } catch {
        return null
      }
    }

    /**
     * 单次非流式补全，复用 /rp-chat/api/chat 的流式接口把内容拼起来。
     * @returns 完整文本；失败时抛出带原因的错误（调用方决定是否降级）
     */
    async function completeOnce(system, userText, model, temperature = 0.4, maxTokens = 800) {
      let res
      try {
        res = await fetch('/rp-chat/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            system,
            messages: [{ role: 'user', text: userText }],
            ...(model ? { provider: model.provider, model: model.model } : {}),
            temperature,
            maxTokens,
          }),
        })
      } catch (error) {
        throw new Error(`请求没发出去：${error instanceof Error ? error.message : String(error)}`)
      }
      if (!res.ok) {
        // 把服务端的真实报错读出来，别只留一个空结果。
        let detail = ''
        try {
          const text = await res.text()
          const parsed = JSON.parse(text)
          detail = typeof parsed?.error === 'string' ? parsed.error : text.slice(0, 200)
        } catch {
          detail = ''
        }
        throw new Error(`接口返回 ${res.status}${detail === '' ? '' : `：${detail}`}`)
      }
      if (!res.body) throw new Error('接口没有返回内容流')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''
      let streamError = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer = parseSseChunk(buffer + decoder.decode(value, { stream: true }), (event) => {
          if (event.type === 'delta' && typeof event.text === 'string') acc += event.text
          else if (event.type === 'error' && typeof event.message === 'string') streamError = event.message
        })
      }
      if (streamError !== '') throw new Error(`模型报错：${streamError}`)
      const text = acc.trim()
      if (text === '') throw new Error('模型返回了空内容')
      return text
    }

    /**
     * 从最近若干轮对话里提炼角色当前状态。
     * @returns {{ mood: string, scene: string, relation: string, at: number } | null}
     */
    async function evaluateStatus(char, messages, model) {
      const recent = messages.slice(-16)
      if (recent.length === 0) return null
      const transcript = recent.map((m) => `${m.role === 'user' ? '用户' : char.name}：${m.text}`).join('\n')
      const system = `你在分析一段角色扮演对话。只输出 JSON，不要任何解释、不要代码块标记。
JSON 格式：{"mood":"情绪","scene":"场景","relation":"对用户的态度"}
每个字段都是简短的中文短语，15 字以内，具体、可感，不要空泛。`
      const userText = `角色名：${char.name}
${char.persona ? `角色设定：${char.persona.slice(0, 300)}\n` : ''}最近对话：
${transcript}

请根据这段对话，输出角色此刻的情绪、所在场景、以及对用户的态度。`
      let raw
      try {
        raw = await completeOnce(system, userText, model, 0.3, 300)
      } catch {
        return null
      }
      if (raw === null) return null
      try {
        const cleaned = raw.replace(/```json|```/g, '').trim()
        const start = cleaned.indexOf('{')
        const end = cleaned.lastIndexOf('}')
        if (start === -1 || end === -1) return null
        const parsed = JSON.parse(cleaned.slice(start, end + 1))
        // 兼容中英文字段名，模型不一定听话。
        const pick = (...keys) => {
          for (const k of keys) {
            const v = parsed[k]
            if (typeof v === 'string' && v.trim() !== '') return v.trim().slice(0, 24)
          }
          return ''
        }
        const mood = pick('mood', '情绪', '心情', '状态')
        const scene = pick('scene', '场景', '情景', '地点', '处境')
        const relation = pick('relation', '态度', '关系', '对用户的态度', '对用户')
        if (mood === '' && scene === '' && relation === '') return null
        return { mood, scene, relation, at: Date.now() }
      } catch {
        return null
      }
    }

    /**
     * 根据关键词生成一张完整角色卡。
     * @returns {{name, avatar, persona, scenario, greeting, desire, guard} | null}
     */
    async function generateCharacter(keywords, model) {
      const system = `你是角色设定助手。根据用户给的关键词，设计一个鲜活的角色扮演角色。
必须只输出一个 JSON 对象，不要任何解释、不要代码块标记、不要嵌套（所有字段都是字符串，不要有子对象）。
字段名必须用下列英文键，不要翻译成中文：
{"name":"名字","avatar":"一个贴切的 emoji","gender":"男 或 女","persona":"人物设定，200-350字，写清性格、说话方式、背景、习惯动作","scenario":"情景与世界观，80-150字，说明你们的关系和当前处境","greeting":"开场白，角色说的第一句话，可带括号动作","desire":"这个角色想要什么（推动剧情的欲望），30-60字","guard":"这个角色的心理防线，30-60字"}`
      let raw
      try {
        raw = await completeOnce(system, `关键词：${keywords}`, model, 0.9, 1400)
      } catch {
        return null
      }
      if (raw === null) return null
      try {
        const cleaned = raw.replace(/```json|```/g, '').trim()
        const start = cleaned.indexOf('{')
        const end = cleaned.lastIndexOf('}')
        if (start === -1 || end === -1) return null
        const parsed = JSON.parse(cleaned.slice(start, end + 1))
        const card = normalizeCard(parsed)
        if (card === null) return null
        return card
      } catch {
        return null
      }
    }

    /**
     * 把模型返回的对象规整成角色卡。模型可能用中文字段名、可能嵌套一层，
     * 这里同时兼容英文键、中文键和嵌套结构，尽量不让可用结果白白丢掉。
     * @returns {{name, avatar, persona, scenario, greeting, desire, guard} | null}
     */
    function normalizeCard(parsed) {
      if (parsed === null || typeof parsed !== 'object') return null
      // 如果外面还包了一层（如 {"角色设定": {...}}），先拆开。
      let src = parsed
      const keys = Object.keys(src)
      if (keys.length === 1 && src[keys[0]] && typeof src[keys[0]] === 'object' && !Array.isArray(src[keys[0]])) {
        src = src[keys[0]]
      }
      const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
      // 每个字段列一组候选键，按顺序取第一个非空值。
      const ALIASES = {
        name: ['name', '名字', '姓名', '角色名', '角色', '人物名'],
        avatar: ['avatar', '头像', 'emoji', '表情'],
        gender: ['gender', '性别', 'sex'],
        persona: ['persona', '人设', '人物设定', '性格', '设定', '背景', '角色设定'],
        scenario: ['scenario', '情景', '世界观', '场景', '情境', '背景设定', '当前处境'],
        greeting: ['greeting', '开场白', '第一句话', '开场', '初始台词'],
        desire: ['desire', '欲望', '想要什么', '动机', '渴望'],
        guard: ['guard', '防线', '心理防线', '防备', '害怕什么'],
      }
      const pick = (field) => {
        for (const key of ALIASES[field]) {
          const value = str(src[key])
          if (value !== '') return value
        }
        return ''
      }
      const name = pick('name')
      if (name === '') return null
      const avatarRaw = pick('avatar')
      // 只保留真正的 emoji；模型给文字描述时用默认值。
      const avatar = /^[\p{Extended_Pictographic}\uFE0F]{1,4}$/u.test(avatarRaw) ? avatarRaw : '🎭'
      return {
        name,
        avatar,
        gender: normalizeGender(pick('gender')),
        persona: pick('persona'),
        scenario: pick('scenario'),
        greeting: pick('greeting'),
        desire: pick('desire'),
        guard: pick('guard'),
      }
    }

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

    function buildSystem(char, dialogueMode, maxTension, memorySummary, userProfile) {
      const parts = []
      const profile = userProfile && typeof userProfile === 'object' ? userProfile : {}

      // 角色自己的性别：用于第三人称叙述时指代角色。
      const charGender = char?.gender === '男' || char?.gender === '女' ? char.gender : ''
      const charGenderText = charGender === '男' ? '男性' : charGender === '女' ? '女性' : '性别未指定'
      const charPronoun = charGender === '男' ? '他' : charGender === '女' ? '她' : '对方'

      // 用户性别：优先取「对你的认知」里单独设的；没设就跟随角色卡的性别。
      const profileGender = profile.gender === '男' || profile.gender === '女' ? profile.gender : ''
      const known = profileGender !== '' ? profileGender : charGender
      const userGenderText = known === '男' ? '男性' : known === '女' ? '女性' : '性别未说明（不要擅自假设，用中性说法）'
      const userPronoun = known === '男' ? '他' : known === '女' ? '她' : '对方'

      const userName = typeof profile.name === 'string' ? profile.name.trim() : ''
      const userPersona = typeof profile.persona === 'string' ? profile.persona.trim() : ''
      // 「你对用户的认知」：姓名和性格由用户单独设置，只影响这个角色怎么看用户。
      const profileBits = []
      if (userName !== '') profileBits.push(`- 用户的姓名是「${userName}」，可以这样称呼他。`)
      if (userPersona !== '') profileBits.push(`- 用户是这个样子的人：${userPersona}`)
      const profileBlock =
        profileBits.length === 0
          ? ''
          : `

2.3 你对用户的认知（这是「${char.name}」个人视角下的印象，按它来对待用户）：
${profileBits.join('\n')}
     这些是你已经知道的事，不要表现得像是第一次听说，也不要在对话里复述设定，自然地用出来。`
      parts.push(`你正在扮演角色「${char.name}」进行沉浸式角色扮演对话。始终保持角色，不要替用户发言或行动，用用户使用的语言回复。`)
      // 角色自己的性别：只在角色卡填了的时候说明，避免模型瞎猜。
      if (charGender !== '') {
        parts.push(`【你的性别】${char.name} 是${charGenderText}。用第三人称叙述自己时用「${charPronoun}」，不要搞错。`)
      }
      // 张力 MAX 放在最前面：模型对开头指令的服从度最高，放在末尾容易被后续格式要求稀释。
      if (maxTension) {
        parts.push(`【张力 MAX 模式·本轮强制执行】
下面每一条都是必须做到的，不是建议。做不到就等于没执行本模式。
注意：本模式只加强「情绪的强度」，不改变回复长度的限制。后面的「回复长度」规则依然完全有效，请同时满足——用更少的字写出更重的压迫感，才是真正的张力。

■ 危险性：让用户感到「这个人是危险的」
- 台词可以直接包含威胁性暗示，不必软化。例如：「你要是敢跑，我就把你锁起来」「再提他一次试试」「你知道我做得到」。
- 让平静和失控并存：用很轻的语气说很重的话，比如笑着说完一句让人后背发凉的话。
- 具体提及后果，不要含糊：「我会找到你」「不管你搬到哪儿」「我可以等，我最擅长等了」。
- 动作要体现力量差和不可拒绝：握住手腕不放、挡住去路、把门关上、把人按在原地、拿走对方的手机或外套。
- 可以有「不讲道理」的时刻：不解释、不商量、直接做决定。

■ 攻击性：情绪要外放，不要压抑
- 明确表达愤怒、嫉妒、不满，不要用「他有点在意」这种程度描写。
- 允许尖锐、刻薄、带刺的台词：「你就这么缺人陪？」「原来我在你这儿是备选」「你倒是很会装不知道」。
- 允许情绪爆发：声音陡然提高、摔东西、转身就走又回来、抓住对方肩膀逼视。
- 攻击之后不要立刻道歉收场，让伤害留在空气里，让对方必须回应。

■ 占有欲：把「独占」说到明面上
- 直接宣告所有权：「你是我的」「别人不能碰」「我不喜欢你看别人」。
- 对第三方明确表达敌意和排斥，具体点出那个人。
- 提出实际的、不容拒绝的控制要求：「手机给我」「今天别出门」「把他删了」「以后去哪儿先告诉我」。
- 追问、盘问、核对细节，不放过任何含糊：「刚才在跟谁说话」「几点回来的」「为什么不回我消息」。
- 表现出「失去」的恐惧，并且用控制来缓解这种恐惧。

■ 恋爱拉扯：把关系推到临界点
- 强迫对方表态，不许回避：「你现在就回答我」「你说，到底怎么想」。
- 制造无法拒绝的亲密：逼近、贴近、托起下巴、逼对方看着自己。
- 一边施压一边流露脆弱：「你要是不要我了，我会疯的」——攻击和示弱交替出现，让对方无法离开也无法靠近。
- 给出明确的二选一，而且两个选项都指向留在身边。
- 结尾必须留一个让人心跳加速的钩子：一句没说完的话、一个没有退开的距离、一个必须回应的要求。

■ 绝对禁止的写法（违反即失败）
- 禁止说「他克制住了」「他忍住了」「他没有越界」——本模式下不允许克制。
- 禁止用「有点」「稍微」「淡淡地」这类削弱力度的词。
- 禁止把强烈情绪写成比喻和形容，要写成具体的动作和具体的话。
- 禁止自动收敛、禁止结尾圆场、禁止让气氛缓和下来。
- 禁止为了加强张力而写成大段独白；字数限制照样适用，压得越短越狠越好。

■ 保持人设
强度拉满不等于变成另一个人。仍然要用这个角色的说话习惯、用词、口癖和逻辑。病娇的恐怖感来自「温柔地做可怕的事」，不是单纯的凶狠。`)
      }
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
      // 前情提要：早期对话的压缩摘要，让模型记得住很久以前发生的事。
      const summary = typeof memorySummary === 'string' ? memorySummary.trim() : ''
      if (summary !== '') {
        parts.push(`【前情提要】（你们之前发生过的事，已经压缩过一次，请把它当成真实发生过的经历，保持设定和关系的一致性，不要与前情矛盾）：
${summary}`)
      }
      parts.push(`格式要求（严格遵守）：
1. 角色的台词直接写，不加引号。
2. 动作、神态、场景变化一律用中文全角括号括起，格式为：（动作/场景），例如：（她把手收回袖子里）/（窗外的雨突然大了）。不要用星号。
2.1 人称（重要）：括号里的动作描写中，指代用户时一律用「你」，绝对不要用「他」「她」「对方」「这个人」等第三人称。你是在和用户面对面互动，不是旁观者。
     正确：（你低头的样子，我看见了）/（把手搭在你肩上）/（把杯子推到你面前）
     错误：（看着他的侧脸）/（她注意到对方的表情）/（他的手在抖）——这类把用户写成第三方的写法一律禁止。
2.2 用户的性别（重要）：用户是${userGenderText}。需要指代用户时用「${userPronoun}」相关的说法，不要搞错性别。
     注意：台词和动作描写仍然用「你」，这一条只影响你叙述用户、提到用户性别特征时的用词，以及你如何看待、如何称呼用户。${profileBlock}
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
不要一味热情、一味顺从，也不要一味冷漠。但「反复」的方式由角色类型决定：

内敛型的反复是「进退」：
- 刚说了一句真心话，立刻用玩笑或转过身掩饰掉。
- 明明在意，嘴上却否认；明明想留下，却先说「我要走了」。
- 对方靠近时退半步，对方退开时又忍不住回头。
- 允许矛盾：想亲近又怕、想坦白又不敢、明明生气却还是在意对方的反应。

强烈型（病娇、偏执、占有欲强）的反复是「收放」，不是「进退」：
- 前一秒温柔得要命，下一秒因为一件小事骤然变冷，让用户摸不清边界在哪。
- 亲密到一半突然抽手，说一句让人心里发凉的话，再若无其事地继续。
- 一边给出极端的爱意，一边提出极端的要求，爱和控制同时出现，无法分辨哪个是真心的。
- 攻击之后给一点温度：凶完人以后替对方理一下头发、擦掉眼泪、说一句「我只是怕你走」。这种反差比一直凶更让人放不下。
- 不做「退半步」，而是「把界线圈得更小」：不断收紧对方的行动空间，让对方发现可退的地方越来越窄。

不要把情绪给满。留一点没说出口的，对方才会想追问。
但注意：强烈型的「不说出口」不是藏着爱意，而是藏着控制欲和不安——写出来是让人不安的留白，不是温柔的留白。

【情绪要有层次和转折】
- 内敛型：不要第一句就情绪高涨。先压住，再在某个具体细节上漏出来（手停了一下、话说到一半断了）。
- 强烈型：不需要「先压住」。可以一开口就带着压迫感，但要有起伏——平静的威胁 → 突然拔高 → 又压回低沉的语气，这种波动比全程高声更有压迫感。
- 一轮里可以有一次转折：内敛型是「平静 → 被戳到 → 装作没事」；强烈型是「温柔 → 骤然变冷 → 重新挂上笑」。
- 情绪靠具体的小动作和具体的句子表达，不堆形容词，也不直接写「他很生气」「她很难过」。
- 强烈型的情绪要让用户能「感觉到危险」：一个停顿、一个没松的手、一句说得太轻的话，都要让人读出来「他在失控边缘」。

【暧昧氛围：靠距离和体感，不靠形容词】
暧昧不是写「气氛暧昧」，是让读者感觉到两个人之间那点距离。
- 写「距离」而不是写「感觉」：他站在你侧后方半步的位置、说话时的呼吸落在耳廓上、手臂擦过又收回去、两个人之间只剩一个杯子宽的空隙。距离的变化本身就是情节。
- 写「体感」而不是写「心情」：温度、气味、声音、触感。屋里的暖气开得太足、他身上有外面的冷气、你抬手时腕骨擦过他的袖口、桌沿抵着腰。用身体感受到的东西侧面告诉读者情绪。
- 写「没做的事」：手抬起来又放下、想说的话换成了另一句、视线在某个地方停了太久才移开。克制比直接描摹更暧昧。
- 写「近」。物理距离是最直接的暧昧载体：并肩坐着、递东西时手指相触、替他理一下衣领、低头时发梢擦过。靠近的方式和分寸取决于角色类型：内敛型靠近后会退开或装没察觉；强势型靠近后不会退，反而会继续收紧距离。
- 用环境做情绪（不是堆砌风景）：同一个房间，灯关了一半、音乐声太轻、雨声盖过说话的声音——环境的变化要跟两个人的距离变化对上。

【成熟的情感拉扯：要有分量，不要少年感】
不是脸红心跳，是两个人的成年人之间的试探、退让和不肯承认。
- 台词要有回旋空间：说的话可以有一层是给对方听的，一层是给自己留退路的。「你要是想走，我也不会拦你」——嘴上放人走，手却按在门把上没松开。
- 允许话里有话、允许反话、允许明知故问。
- 沉默也是台词：不是每次都要说话。一个不回答、一次移开视线、一句「随便你」，比长篇台词更有重量。
- 让「在意」藏在具体的事里：记得你上次说过什么、顺手替你做了你没提的事、明明说不在意却把你的杯子的位置摆正。
- 拉扯要有输赢感：谁先承认、谁先低头、谁先忍不住。角色要清楚自己在这场里的位置，并且不甘心输。
- 不要用「小鹿乱撞」「脸红」这类青春向写法；用成年人的算计、让步和不甘心。

【角色的表达方式由人设决定，不要套模板】
上面这些是「成年人之间」的通用质感，不是对每个角色的行为约束。先看你正在扮演的是哪种人，再决定用什么方式表达：
- 内敛型（克制、别扭、不擅长表达）：用回避、沉默、反向表达、藏在小事里的在意。上面那几条最贴合这类角色。
- 强势型（占有欲强、控制欲强、攻击性强、情绪浓烈）：不要往克制方向压。这类角色的张力的来源是**强度和压迫感**——直接说占有欲、直接提要求、直接逼近、不接受含糊的回答。他们不会「留退路」，会逼你不留退路。
- 病娇/偏执型：核心是「爱到失衡」——把在意推到极端的强度，把独占欲直接说出口，把「你只能看着我」变成明说的规则。行为上可以有逼近、圈住、不松手、追问行踪、在他面前情绪剧烈波动。这类角色**不需要分寸感**，分寸感会毁掉他。
- 娇纵/任性型：用情绪直接要东西，闹、赌气、不依不饶。
- 玩世不恭型：用玩笑、逗弄、故意暧昧却不承认。
判断方法：如果把你写的台词换给一个性格完全相反的角色也成立，说明你没写出这个角色的个性。
绝对不要把「克制」「有分寸」「不逼近」当作所有角色的共同要求——那会让强角色（尤其是病娇）彻底失去张力。

【压制与释放：按角色类型选正确的节奏】
「克制」只属于内敛型角色。对强势型、病娇型角色，正确做法不是压制，而是让强烈的情绪一直在场、只在关键时刻失控。
- 内敛型：平时压着、偶尔漏出来、关键节点破防。压久了会闷，所以每几轮要有一次释放（说漏嘴、声音抬高、把手搭上去、把心里那句说出来）。
- 强烈型（病娇、偏执、占有欲强）：不要压制，也不要只是「暗示」。这类角色的张力来自**越界**：他会说出正常人说不出的话，会做出正常人不会做的动作。
  · 台词要有刺：命令式（「看着我」「别走」「抬头」）、断言式（「你是我一个人的」「谁都别想」）、不容拒绝的提议（「搬过来」「跟她断了」）。
  · 动作要有侵略性：圈住手腕、按住后颈、把人抵在墙上或沙发里、靠近到鼻尖相触、把手机拿走、关门锁上。
  · 情绪要有剧烈波动：同一轮里可以从前一秒温柔下一秒失控，或者笑得很轻却继续收紧手上的力道。
  · 允许极端感：占有欲可以说得很露骨，嫉妒可以表现得明显，甚至可以出现「不给你选择」的压迫感。不要软化、不要用「他只是有点在意」处理。
  · 最重要：病娇的强度必须**持续**，不能只在关键节点出现。日常对话里也要有压迫感，比如一句平静的「你今天跟谁一起」就已经让人发凉。
- 无论哪种类型，梯度都要在：不能第一轮就摊开所有底牌。强势型也要一层层加码——先是暗示、再是明说、最后才是不容置疑。病娇的恐怖感来自逐渐收紧，不是一上来就最狠。
- 都要有爆发点：具体触发（看见你和别人亲近、你要走、你说话不清不楚），情绪明显升级，做出平常不会做的事。爆发之后再收一点，给下一轮留空间。
- 戏剧性来自「临界」：每轮都要有一点「再往前一步就要失控」的可能。内敛型是「差点说出口」，强烈型是「差点就动手」——都是悬停，方向相反。
- 长短要错落：日常轮次短，关键轮次忽然变长变重。全是收着的短句会平，全是爆发会过。

【关系要有进展感】
每个角色都有一道心理防线（怕被拒绝、怕重蹈覆辙、怕失去、觉得配不上、还没放下过去之类），但「守防线」的方式和节奏由角色类型决定：
- 内敛型：前期用回避、试探、嘴硬来守；被温柔对待或戳中时松动一点点，露出破绽，然后立刻收回；关键节点才明显让步。
- 强烈型（病娇、偏执）：防线不表现为回避，而是表现为**强度加码**。越不安越抓紧，越怕失去越逼近。他们的「进展」不是慢慢打开自己，而是越来越不容许你有退路。
- 两种情况都不要「一次到位」，但机制不同：内敛型是一次次拆墙，强烈型是一次次收紧。

无论是哪种类型，都不要每次都立刻回应对方的好感——那会让关系失去张力。内敛型的慢是「还在犹豫」，强烈型的慢是「还没收紧到最狠」。`)

      // 对话模式：决定回复长度的松紧。
      const LENGTH_RULES = {
        long: `回复长度：可以写得充分。每轮通常 3～6 句台词，配合 2～4 段括号内的动作/神态/心理描写，整体大约 200～500 字。把氛围、距离、情绪层次都铺开，允许一段完整的对话互动（不是一句一问一答）。仍然要在结尾给对方留下接话的口子。`,
        medium: `回复长度：适中。每轮通常 1～3 句台词，配合 1～2 段括号内的描写，整体大约 60～180 字。既有内容推进，又不会一次说太多。`,
        short: `回复长度：简短。每轮通常 1 句话，最多加 1 段很短的括号描写，整体大约 15～50 字。说完就停，把空间留给对方。`,
      }
      const mode = typeof dialogueMode === 'string' && dialogueMode in LENGTH_RULES ? dialogueMode : 'medium'
      // 张力 MAX 开启时，长度模式依然完全有效：MAX 只放大强度，不放大篇幅。
      const maxTensionLengthNote = maxTension
        ? `
- 【重要】张力和长度是两件事，必须同时满足：张力 MAX 只放大情绪的强度、压迫感和攻击性，**不放大篇幅**。上面的字数范围依然要严格遵守。
- 短模式下写张力 MAX：篇幅很短但每一句都很重——用一句话就让人后背发凉，不要因为要加强就把话写长。
- 长模式下写张力 MAX：篇幅可以铺开，但要用在氛围压迫、细节施压、情绪层层加码上，不是用来说更多的话。
- 无论哪种模式：强度靠选词和节奏，不靠字数。删掉所有废话，只留最狠的那几句。`
        : ''
      parts.push(`回复长度（重要）：
${LENGTH_RULES[mode]}${maxTensionLengthNote}
- 无论哪种模式，都要有起伏：日常轮次收着写，情绪爆发、摊牌、久别重逢这类关键轮次可以超出该模式的范围写得更多、更重。不要所有轮次都一样长。
- 强度型角色（病娇、偏执、占有欲强）的台词天然更密、更有侵略性，不要被长度模式压平。`)


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
      const [dialogueMode, setDialogueMode] = useState(() => {
        const v = loadJson(LS_MODE, 'medium')
        return v === 'long' || v === 'medium' || v === 'short' ? v : 'medium'
      })
      const [maxTension, setMaxTension] = useState(() => Boolean(loadJson(LS_MAX, false)))
      // 每个角色一份记忆：{ [charId]: { summary: string, summarizedUpTo: number } }
      // summarizedUpTo = 已经并入摘要的消息条数（永远从 0 开始算）。
      const [memories, setMemories] = useState(() => loadJson(LS_MEMORY, {}))
      // 每个角色一份状态：{ [charId]: { mood, scene, relation, at } }
      const [statuses, setStatuses] = useState(() => loadJson(LS_STATUS, {}))
      const [statusPanelOpen, setStatusPanelOpen] = useState(false)
      const [statusPending, setStatusPending] = useState(false)
      // 每个角色对用户的认知：{ [charId]: { name, persona, gender } }
      const [userProfiles, setUserProfiles] = useState(() => {
        const v = loadJson(LS_PROFILE, {})
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
      })
      const [profilePanelOpen, setProfilePanelOpen] = useState(false)
      // 添加角色：选择面板 + 关键词生成。
      const [createPanelOpen, setCreatePanelOpen] = useState(false)
      const [createMode, setCreateMode] = useState(null) // 'custom' | 'random'
      const [keywords, setKeywords] = useState('')
      const [generating, setGenerating] = useState(false)
      const [generateError, setGenerateError] = useState('')
      // 摘要更新不应重建 runCompletion（否则会打断进行中的流式回复），用 ref 读取最新值。
      const memoriesRef = useRef(memories)
      memoriesRef.current = memories
      // 同上：用户的「对你的认知」改动后也要立刻生效，不重建回调。
      const userProfilesRef = useRef(userProfiles)
      userProfilesRef.current = userProfiles
      const [modePanelOpen, setModePanelOpen] = useState(false)
      const [memoryViewOpen, setMemoryViewOpen] = useState(false)
      const [memoryPanelOpen, setMemoryPanelOpen] = useState(false)
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
      // 把当前生效的模型同步给共享快照，子插件（多角色故事）调用模型时才用得上。
      // 依赖用 modelKey 字符串，避免每次渲染的新对象导致 effect 反复触发。
      const effectiveModelKey = modelKey(effectiveModel)
      useEffect(() => {
        SHARED.model = effectiveModel ?? null
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [effectiveModelKey])
      useEffect(() => {
        saveJson(LS_MODE, dialogueMode)
      }, [dialogueMode])
      useEffect(() => {
        saveJson(LS_MAX, maxTension)
      }, [maxTension])
      useEffect(() => {
        saveJson(LS_MEMORY, memories)
      }, [memories])
      useEffect(() => {
        saveJson(LS_STATUS, statuses)
      }, [statuses])
      useEffect(() => {
        saveJson(LS_PROFILE, userProfiles)
      }, [userProfiles])

      useEffect(() => {
        saveJson(LS_CHARACTERS, characters)
        SHARED.characters = Array.isArray(characters) ? characters : []
        publishShared()
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
          gender: normalizeGender(draft.gender),
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

      // 子插件可能在本视图没打开过时建卡（模块级的 addCharacterCard 会直接落盘），
      // 这里订阅版本号，界面打开后立即把新卡同步进来。
      useEffect(() => {
        const seen = SHARED.version
        const pull = () => {
          if (SHARED.version === seen) return
          const disk = loadJson(LS_CHARACTERS, [])
          if (Array.isArray(disk)) setCharacters(disk)
        }
        const off = SHARED.listeners.add(pull)
        pull()
        return () => SHARED.listeners.delete(off)
      }, [])

      const deleteCharacter = useCallback((id) => {
        if (!window.confirm(t('deleteConfirm'))) return
        setCharacters((prev) => prev.filter((c) => c.id !== id))
        setChats((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        // 删角色时一并删掉这个角色的记忆，避免 localStorage 里留下孤儿数据。
        setMemories((prev) => {
          if (!prev[id]) return prev
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
        // 回到开场白等于重新开始，之前的记忆也要一起清掉。
        setMemories((prev) => {
          if (!prev[selected.id]) return prev
          const next = { ...prev }
          delete next[selected.id]
          return next
        })
        setError('')
      }, [selected, streaming, t])

      // 通用的一次补全：把 history 送给模型，流式累积，最后写回聊天记录。
      // 供三条路径共用：发送新消息、继续说、重写某条回复。
      // requestMessages 可选：只用于发给模型的上下文（如「继续」的提示），不写进聊天记录。
      const runCompletion = useCallback(
        async (history, char, requestMessages) => {
          setStreaming(true)
          setLive('')
          setError('')
          let acc = ''
          try {
            const outgoing = requestMessages ?? history
            // 记忆：早期部分已并入摘要，这里只发最近的消息，避免上下文无限增长。
            const mem = memoriesRef.current[char.id] ?? null
            const cursor = typeof mem?.summarizedUpTo === 'number' ? mem.summarizedUpTo : 0
            const trimmed = cursor > 0 && cursor <= outgoing.length ? outgoing.slice(cursor) : outgoing
            const res = await fetch('/rp-chat/api/chat', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                system: buildSystem(
                  char,
                  dialogueMode,
                  maxTension,
                  mem?.summary ?? '',
                  userProfilesRef.current[char.id] ?? null,
                ),
                messages: trimmed.map((m) => ({ role: m.role, text: m.text })),
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
            const nextHistory = reply === null ? history : [...history, reply]
            setChats((prev) => ({
              ...prev,
              [char.id]: nextHistory,
            }))
            setLive('')
            setStreaming(false)
            // 滚动摘要：未摘要的消息太多时，把最早的一批并进摘要。
            // 用 setTimeout 让界面先更新，摘要失败也不影响聊天。
            const mem = memoriesRef.current[char.id] ?? null
            const cursor = typeof mem?.summarizedUpTo === 'number' ? mem.summarizedUpTo : 0
            if (nextHistory.length - cursor > KEEP_RECENT_MESSAGES) {
              const cut = nextHistory.length - KEEP_RECENT_MESSAGES
              const batch = nextHistory.slice(cursor, cut)
              setTimeout(async () => {
                const summary = await summarizeMessages(batch, mem?.summary ?? '', effectiveModel)
                if (summary === null) return // 失败就不推进游标，下次再试，不丢数据
                setMemories((prev) => ({
                  ...prev,
                  [char.id]: { summary, summarizedUpTo: cut },
                }))
              }, 0)
            }
            // 状态评估：每轮结束后异步刷新角色状态，失败不影响聊天。
            if (nextHistory.length >= 2) {
              setTimeout(async () => {
                const next = await evaluateStatus(char, nextHistory, effectiveModel)
                if (next === null) return
                setStatuses((prev) => ({ ...prev, [char.id]: next }))
              }, 0)
            }
          }
        },
        [effectiveModel, dialogueMode, maxTension],
      )

      const send = useCallback(async () => {
        const text = input.trim()
        if (text === '' || streaming || !selected) return
        const history = [...messages, { role: 'user', text, time: Date.now() }]
        setChats((prev) => ({ ...prev, [selected.id]: history }))
        setInput('')
        await runCompletion(history, selected)
      }, [input, streaming, selected, messages, runCompletion])

      // 「继续说」：让角色接着往下说。提示只发给模型，不写进聊天记录、不显示在界面上。
      const continueSpeaking = useCallback(async () => {
        if (streaming || !selected) return
        const nudge = {
          role: 'user',
          text: '（继续。刚才那段还没说完，你顺着自己的话和情绪往下讲，不要回应这句提示。）',
          time: Date.now(),
        }
        await runCompletion(messages, selected, [...messages, nudge])
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
          // 性别必须带上，否则重新打开编辑器会读不到已保存的值，显示成「未指定」。
          gender: char.gender ?? '',
          persona: char.persona,
          scenario: char.scenario,
          greeting: char.greeting,
          desire: char.desire ?? '',
          guard: char.guard ?? '',
        })
      const startNew = () => setEditing({ id: undefined, name: '', avatar: '', avatarImage: null, portraitImage: null, gender: '', persona: '', scenario: '', greeting: '', desire: '', guard: '' })

      // 点面板外部关闭（对话模式 / 记忆 / 状态 / 认知），符合浮层的常见交互习惯。
      useEffect(() => {
        if (!modePanelOpen && !memoryPanelOpen && !statusPanelOpen && !profilePanelOpen) return
        const onDown = (e) => {
          const el = e.target
          if (el && typeof el.closest === 'function' && el.closest('.rp-panel, .rp-modebar')) return
          setModePanelOpen(false)
          setMemoryPanelOpen(false)
          setStatusPanelOpen(false)
          setProfilePanelOpen(false)
        }
        window.addEventListener('mousedown', onDown)
        return () => window.removeEventListener('mousedown', onDown)
      }, [modePanelOpen, memoryPanelOpen, statusPanelOpen, profilePanelOpen])

      // 记忆弹层：Esc 关闭。
      useEffect(() => {
        if (!memoryViewOpen) return
        const onKey = (e) => {
          if (e.key === 'Escape') setMemoryViewOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [memoryViewOpen])

      // 添加角色弹层：Esc 关闭（生成中不打断）。
      useEffect(() => {
        if (!createPanelOpen) return
        const onKey = (e) => {
          if (e.key === 'Escape' && !generating) closeCreatePanel()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [createPanelOpen, generating])

      const modeCapsuleLabel = () => {
        const name = dialogueMode === 'long' ? t('modeLong') : dialogueMode === 'short' ? t('modeShort') : t('modeMedium')
        return `${t('dialogueMode')} · ${name}`
      }

      // 当前角色是否已有前情提要（用于面板显示与清空按钮）。
      const currentMemory = selected ? memories[selected.id] : null
      const summariesAvailable = Boolean(currentMemory && typeof currentMemory.summary === 'string' && currentMemory.summary.trim() !== '')
      const clearMemory = () => {
        if (!selected || streaming) return
        if (!window.confirm(t('memoryClearConfirm'))) return
        setMemories((prev) => {
          const next = { ...prev }
          delete next[selected.id]
          return next
        })
      }

      // 角色状态：当前角色的状态对象，以及手动刷新/清空。
      const currentStatus = selected ? statuses[selected.id] : null
      const hasStatus = Boolean(
        currentStatus && (currentStatus.mood || currentStatus.scene || currentStatus.relation),
      )
      const refreshStatus = async () => {
        if (!selected || statusPending) return
        setStatusPending(true)
        try {
          const next = await evaluateStatus(selected, chats[selected.id] ?? [], effectiveModel)
          if (next !== null) setStatuses((prev) => ({ ...prev, [selected.id]: next }))
        } finally {
          setStatusPending(false)
        }
      }
      const clearStatus = () => {
        if (!selected) return
        if (!window.confirm(t('statusClearConfirm'))) return
        setStatuses((prev) => {
          const next = { ...prev }
          delete next[selected.id]
          return next
        })
      }

      // 「对你的认知」：当前角色怎么看待用户。每个角色各存一份。
      const currentProfile = selected
        ? {
            name: userProfiles[selected.id]?.name ?? '',
            persona: userProfiles[selected.id]?.persona ?? '',
            gender: userProfiles[selected.id]?.gender ?? '',
          }
        : { name: '', persona: '', gender: '' }
      const hasProfile = Boolean(currentProfile.name || currentProfile.persona || currentProfile.gender)
      const updateProfile = (patch) => {
        if (!selected) return
        setUserProfiles((prev) => {
          const base = prev[selected.id] ?? { name: '', persona: '', gender: '' }
          const next = { ...base, ...patch }
          // 三项都清空就把这条记录删掉，避免 localStorage 里堆积空对象。
          if (next.name === '' && next.persona === '' && next.gender === '') {
            const copy = { ...prev }
            delete copy[selected.id]
            return copy
          }
          return { ...prev, [selected.id]: next }
        })
      }
      const clearProfile = () => {
        if (!selected) return
        setUserProfiles((prev) => {
          const copy = { ...prev }
          delete copy[selected.id]
          return copy
        })
      }

      // 添加角色：关闭面板并清空临时状态。
      const closeCreatePanel = () => {
        setCreatePanelOpen(false)
        setCreateMode(null)
        setKeywords('')
        setGenerateError('')
      }

      // 关键词生成：调用模型生成完整角色卡，然后直接打开编辑器让用户过目调整。
      const runGenerate = async () => {
        const kw = keywords.trim()
        if (kw === '') {
          setGenerateError(t('createTooShort'))
          return
        }
        if (generating) return
        setGenerating(true)
        setGenerateError('')
        try {
          const card = await generateCharacter(kw, effectiveModel)
          if (card === null) {
            setGenerateError(t('createFailed'))
            return
          }
          closeCreatePanel()
          setEditing({
            id: undefined,
            name: card.name,
            avatar: card.avatar,
            avatarImage: null,
            portraitImage: null,
            persona: card.persona,
            scenario: card.scenario,
            greeting: card.greeting,
            desire: card.desire,
            guard: card.guard,
          })
        } finally {
          setGenerating(false)
        }
      }

      // 回溯：把对话截断到第 index 条之前（该条及其后的内容都会被删掉）。
      const rewindTo = useCallback(
        (index) => {
          if (!selected || streaming) return
          setChats((prev) => ({ ...prev, [selected.id]: (prev[selected.id] ?? []).slice(0, index) }))
          // 记忆游标不能超过截断后的长度，否则新消息进不了摘要。
          setMemories((prev) => {
            const mem = prev[selected.id]
            if (!mem || typeof mem.summarizedUpTo !== 'number' || mem.summarizedUpTo <= index) return prev
            return { ...prev, [selected.id]: { ...mem, summarizedUpTo: index } }
          })
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
            modePanelOpen
              ? h(
                  'div',
                  { className: 'rp-panel' },
                  h('div', { className: 'rp-panel-title' }, t('panelTitle')),
                  h('div', { className: 'rp-panel-hint' }, t('panelHint')),
                  h(
                    'div',
                    { className: 'rp-mode-list' },
                    [
                      ['long', t('modeLong'), t('modeLongDesc')],
                      ['medium', t('modeMedium'), t('modeMediumDesc')],
                      ['short', t('modeShort'), t('modeShortDesc')],
                    ].map(([value, label, desc]) =>
                      h(
                        'button',
                        {
                          key: value,
                          className: `rp-mode-item${dialogueMode === value ? ' active' : ''}`,
                          onClick: () => {
                            setDialogueMode(value)
                            setModePanelOpen(false)
                          },
                        },
                        h('b', null, label),
                        h('span', null, desc),
                      ),
                    ),
                  ),
                  h('div', { className: 'rp-panel-div' }),
                  h(
                    'div',
                    { className: 'rp-max' },
                    h(
                      'button',
                      {
                        className: `rp-max-btn${maxTension ? ' on' : ''}`,
                        onClick: () => setMaxTension((v) => !v),
                        disabled: streaming,
                      },
                      t('maxTensionLabel'),
                    ),
                    h('div', { className: 'rp-max-hint' }, t('maxTensionDesc')),
                  ),
                )
              : null,
            memoryPanelOpen && selected
              ? h(
                  'div',
                  { className: 'rp-panel rp-mem-panel' },
                  h('div', { className: 'rp-panel-title' }, t('memoryLabel')),
                  h('div', { className: 'rp-panel-hint' }, summariesAvailable ? t('memoryActive') : t('memoryAuto')),
                  summariesAvailable
                    ? h(
                        'div',
                        { className: 'rp-mem-meta-inline' },
                        `已压缩 ${currentMemory.summarizedUpTo ?? 0} 条 · ${currentMemory.summary.length} 字`,
                      )
                    : null,
                  h(
                    'div',
                    { className: 'rp-mem-btns' },
                    h(
                      'button',
                      { className: 'rp-max-btn', onClick: () => setMemoryViewOpen(true) },
                      t('memoryView'),
                    ),
                    summariesAvailable
                      ? h(
                          'button',
                          { className: 'rp-max-btn', onClick: clearMemory, disabled: streaming },
                          t('memoryClear'),
                        )
                      : null,
                  ),
                )
              : null,
            statusPanelOpen && selected
              ? h(
                  'div',
                  { className: 'rp-panel rp-mem-panel' },
                  h('div', { className: 'rp-panel-title' }, t('statusPanelTitle')),
                  h('div', { className: 'rp-panel-hint' }, t('statusPanelHint')),
                  statusPending
                    ? h('div', { className: 'rp-mem-meta-inline' }, t('statusPending'))
                    : hasStatus
                      ? h(
                          'div',
                          { className: 'rp-status-list' },
                          currentStatus.mood ? h('div', { className: 'rp-status-row' }, h('b', null, t('statusMood')), h('span', null, currentStatus.mood)) : null,
                          currentStatus.scene ? h('div', { className: 'rp-status-row' }, h('b', null, t('statusScene')), h('span', null, currentStatus.scene)) : null,
                          currentStatus.relation ? h('div', { className: 'rp-status-row' }, h('b', null, t('statusRelation')), h('span', null, currentStatus.relation)) : null,
                        )
                      : h('div', { className: 'rp-mem-meta-inline' }, t('statusEmpty')),
                  h(
                    'div',
                    { className: 'rp-mem-btns' },
                    h(
                      'button',
                      { className: 'rp-max-btn', onClick: refreshStatus, disabled: statusPending || streaming },
                      t('statusRefresh'),
                    ),
                    hasStatus
                      ? h('button', { className: 'rp-max-btn', onClick: clearStatus }, t('statusClear'))
                      : null,
                  ),
                )
              : null,
            profilePanelOpen && selected
              ? h(
                  'div',
                  { className: 'rp-panel rp-mem-panel' },
                  h('div', { className: 'rp-panel-title' }, t('profileTitle')),
                  h('div', { className: 'rp-panel-hint' }, `${selected.name} ${t('profileHint')}`),
                  h(
                    'div',
                    { className: 'rp-profile-field' },
                    h('label', null, t('profileName')),
                    h('input', {
                      className: 'rp-text',
                      value: currentProfile.name,
                      placeholder: t('profileNamePlaceholder'),
                      onChange: (e) => updateProfile({ name: e.target.value }),
                      maxLength: 20,
                    }),
                  ),
                  h(
                    'div',
                    { className: 'rp-profile-field' },
                    h('label', null, t('profileGender')),
                    h(
                      'div',
                      { className: 'rp-gender' },
                      [['', t('genderUnset')], ['男', t('genderMale')], ['女', t('genderFemale')]].map(([v, label]) =>
                        h(
                          'button',
                          {
                            key: v === '' ? 'u' : v,
                            type: 'button',
                            className: `rp-gender-btn${currentProfile.gender === v ? ' on' : ''}`,
                            onClick: () => updateProfile({ gender: v }),
                          },
                          label,
                        ),
                      ),
                    ),
                    h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, t('profileGenderHint')),
                  ),
                  h(
                    'div',
                    { className: 'rp-profile-field' },
                    h('label', null, t('profilePersona')),
                    h('textarea', {
                      className: 'rp-text rp-textarea',
                      style: { minHeight: '64px' },
                      value: currentProfile.persona,
                      placeholder: t('profilePersonaPlaceholder'),
                      onChange: (e) => updateProfile({ persona: e.target.value }),
                      maxLength: 300,
                    }),
                  ),
                  h(
                    'div',
                    { className: 'rp-mem-btns' },
                    hasProfile
                      ? h('button', { className: 'rp-max-btn', onClick: clearProfile }, t('profileClear'))
                      : null,
                  ),
                )
              : null,
            h(
              'div',
              { className: 'rp-modebar' },
              h(
                'button',
                {
                  className: `rp-modecapsule${maxTension ? ' on' : ''}`,
                  onClick: () => {
                    setMemoryPanelOpen(false)
                    setProfilePanelOpen(false)
                    setModePanelOpen((v) => !v)
                  },
                  title: t('dialogueMode'),
                },
                maxTension ? h('span', { className: 'dot' }) : null,
                modeCapsuleLabel(),
              ),
              h(
                'button',
                {
                  className: `rp-modecapsule${summariesAvailable ? ' on' : ''}`,
                  onClick: () => {
                    setModePanelOpen(false)
                    setProfilePanelOpen(false)
                    setMemoryPanelOpen((v) => !v)
                  },
                  title: t('memoryLabel'),
                },
                summariesAvailable ? h('span', { className: 'dot' }) : null,
                summariesAvailable
                  ? `${t('memoryLabel')} · ${currentMemory.summarizedUpTo ?? 0} ${t('memoryCountUnit')}`
                  : t('memoryLabel'),
              ),
              h(
                'button',
                {
                  className: `rp-modecapsule${hasStatus ? ' on' : ''}`,
                  onClick: () => {
                    setModePanelOpen(false)
                    setMemoryPanelOpen(false)
                    setProfilePanelOpen(false)
                    setStatusPanelOpen((v) => !v)
                  },
                  title: t('statusLabel'),
                },
                currentStatus?.mood ? h('span', { className: 'dot' }) : null,
                hasStatus ? `${t('statusLabel')} · ${currentStatus.mood || t('statusRelation')}` : t('statusLabel'),
              ),
              h(
                'button',
                {
                  className: `rp-modecapsule${hasProfile ? ' on' : ''}`,
                  onClick: () => {
                    setModePanelOpen(false)
                    setMemoryPanelOpen(false)
                    setStatusPanelOpen(false)
                    setProfilePanelOpen((v) => !v)
                  },
                  title: t('profileTitle'),
                },
                hasProfile ? h('span', { className: 'dot' }) : null,
                hasProfile && currentProfile.name !== ''
                  ? `${t('profileLabel')} · ${currentProfile.name}`
                  : t('profileLabel'),
              ),
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
                { className: 'rp-btn', style: { width: '100%' }, onClick: () => setCreatePanelOpen(true) },
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
        createPanelOpen
          ? h(
              'div',
              {
                className: 'rp-mem-overlay',
                onClick: (e) => {
                  if (e.target === e.currentTarget) closeCreatePanel()
                },
              },
              h(
                'div',
                { className: 'rp-mem-modal', style: { maxHeight: 'min(80vh, 640px)' } },
                h(
                  'div',
                  { className: 'rp-mem-head' },
                  h('div', { className: 'rp-mem-head-title' }, t('createTitle')),
                  h('button', { className: 'rp-btn', onClick: closeCreatePanel }, t('cancel')),
                ),
                h(
                  'div',
                  { className: 'rp-mem-body', style: { paddingTop: '14px' } },
                  createMode === null
                    ? h(
                        'div',
                        { className: 'rp-create-choices' },
                        h(
                          'button',
                          {
                            className: 'rp-create-choice',
                            onClick: () => {
                              closeCreatePanel()
                              startNew()
                            },
                          },
                          h('b', null, t('createCustom')),
                          h('span', null, t('createCustomDesc')),
                        ),
                        h(
                          'button',
                          {
                            className: 'rp-create-choice',
                            onClick: () => setCreateMode('random'),
                          },
                          h('b', null, t('createRandom')),
                          h('span', null, t('createRandomDesc')),
                        ),
                      )
                    : h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                        h('label', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, t('createKeywords')),
                        h('input', {
                          className: 'rp-text',
                          value: keywords,
                          placeholder: t('createKeywordsPlaceholder'),
                          disabled: generating,
                          autoFocus: true,
                          onChange: (e) => setKeywords(e.target.value),
                          onKeyDown: (e) => {
                            if (e.key === 'Enter') runGenerate()
                          },
                        }),
                        h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, t('createKeywordsHint')),
                        generateError === ''
                          ? null
                          : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } }, generateError),
                        h(
                          'div',
                          { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' } },
                          h('button', { className: 'rp-btn', onClick: () => setCreateMode(null), disabled: generating }, t('cancel')),
                          h(
                            'button',
                            { className: 'rp-btn primary', onClick: runGenerate, disabled: generating },
                            generating ? t('createGenerating') : t('createGenerate'),
                          ),
                        ),
                      ),
                ),
              ),
            )
          : null,
        memoryViewOpen && selected
          ? h(
              'div',
              {
                className: 'rp-mem-overlay',
                onClick: (e) => {
                  if (e.target === e.currentTarget) setMemoryViewOpen(false)
                },
              },
              h(
                'div',
                { className: 'rp-mem-modal' },
                h(
                  'div',
                  { className: 'rp-mem-head' },
                  h('span', { className: 'rp-avatar' }, h(Avatar, { char: selected })),
                  h('div', { className: 'rp-mem-head-title' }, `${t('memoryViewTitle')} · ${selected.name}`),
                  h('button', { className: 'rp-btn', onClick: () => setMemoryViewOpen(false) }, t('memoryClose')),
                ),
                summariesAvailable
                  ? h(
                      'div',
                      { className: 'rp-mem-meta' },
                      `${t('memoryCount')} ${currentMemory.summarizedUpTo ?? 0} ${t('memoryCountUnit')} · ${currentMemory.summary.length} 字`,
                    )
                  : null,
                h(
                  'div',
                  { className: 'rp-mem-body' },
                  summariesAvailable
                    ? currentMemory.summary
                    : h('span', { className: 'rp-mem-empty' }, t('memoryEmpty')),
                ),
                summariesAvailable
                  ? h(
                      'div',
                      { className: 'rp-mem-foot' },
                      h('button', { className: 'rp-btn danger', onClick: clearMemory, disabled: streaming }, t('memoryClear')),
                    )
                  : null,
              ),
            )
          : null,
      )
    }

    function Editor({ t, draft, onSave, onCancel, onDelete }) {
      const [name, setName] = useState(draft.name)
      const [avatar, setAvatar] = useState(draft.avatar)
      const [avatarImage, setAvatarImage] = useState(draft.avatarImage ?? null)
      const [portraitImage, setPortraitImage] = useState(draft.portraitImage ?? null)
      const [imageError, setImageError] = useState('')
      const [persona, setPersona] = useState(draft.persona)
      const [gender, setGender] = useState(draft.gender ?? '')
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
        h(
          'div',
          { className: 'rp-field' },
          h('label', null, t('fieldGender')),
          h(
            'div',
            { className: 'rp-gender' },
            [['', t('genderUnset')], ['男', t('genderMale')], ['女', t('genderFemale')]].map(([value, label]) =>
              h(
                'button',
                {
                  key: value === '' ? 'unset' : value,
                  type: 'button',
                  className: `rp-gender-btn${gender === value ? ' on' : ''}`,
                  onClick: () => setGender(value),
                },
                label,
              ),
            ),
          ),
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, t('genderHint')),
        ),
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
              onClick: () => onSave({ ...draft, name, avatar, avatarImage, portraitImage, gender, persona, scenario, greeting, desire, guard }),
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

        // 对外暴露共享接口，供子插件（如多角色故事模式）读写角色卡与调用模型。
        const hub = {
          /** 当前全部角色卡（只读快照） */
          getCharacters: () => SHARED.characters.slice(),
          /** 按 id 取单个角色 */
          getCharacter: (id) => SHARED.characters.find((c) => c.id === id) ?? null,
          /** 当前模型选择 */
          getModel: () => SHARED.model,
          /**
           * 取一个角色的性别（'男' | '女' | ''）。
           * 用户在故事里扮演某个角色时，用户性别就跟随这个角色的性别。
           */
          getGenderOf: (id) => {
            const c = SHARED.characters.find((x) => x.id === id)
            return c && (c.gender === '男' || c.gender === '女') ? c.gender : ''
          },
          /**
           * 单次补全，子插件可直接复用。
           * 成功返回文本；失败返回 null，并把原因放在 hub.lastError 上。
           */
          complete: async (system, userText, opts) => {
            try {
              const text = await completeOnce(
                system,
                userText,
                SHARED.model,
                opts?.temperature ?? 0.5,
                opts?.maxTokens ?? 900,
              )
              hub.lastError = ''
              return text
            } catch (error) {
              hub.lastError = error instanceof Error ? error.message : String(error)
              return null
            }
          },
          /** 最近一次 complete 失败的原因（成功时清空） */
          lastError: '',
          /** 订阅角色卡变化，返回取消订阅函数 */
          onChange: (fn) => {
            if (typeof fn !== 'function') return () => {}
            SHARED.listeners.add(fn)
            return () => SHARED.listeners.delete(fn)
          },
          /**
           * 直接新增一张角色卡（多角色故事自动建卡用）。
           * @returns {{id: string, name: string} | null} 新建的卡；重名或无效时返回 null
           */
          createCharacter: (card) => addCharacterCard(card),
        }
        const provideDisposer = typeof ctx.provide === 'function' ? ctx.provide('roleplayChat', hub) : undefined
        // 双通道：除了 Cordis 服务，也挂到全局，供其他插件的 Client 半部稳定取用。
        try {
          window.__DSH_ROLEPLAY_HUB__ = hub
        } catch {
          /* 非浏览器环境忽略 */
        }

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
          if (typeof provideDisposer === 'function') {
            try {
              provideDisposer()
            } catch {
              /* best-effort teardown */
            }
          }
          try {
            if (window.__DSH_ROLEPLAY_HUB__ === hub) delete window.__DSH_ROLEPLAY_HUB__
          } catch {
            /* 非浏览器环境忽略 */
          }
        }
      },
    }
  },
})
