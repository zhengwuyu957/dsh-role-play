# dsh-role-play

轻量角色扮演聊天插件，给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用。

**一个可随意设置角色卡的轻量角色扮演，安装即用，简单易上手。**

没有文件导入，没有外部依赖，角色卡和聊天记录都存在浏览器本地。

> 与 `dsh-tavern` 的区别：那个是全功能版（世界书、预设、记忆、关系、变量表、状态栏等）；这个刻意做小，一个视图、几个字段，装完就能用。

## 功能

**角色卡**
- 应用内新建 / 编辑：名字、角色图（导入本地 PNG）、人设、情景、开场白
- 两个可选的剧情字段：**角色想要什么**（推动剧情的欲望）、**角色在防备什么**（心理防线）。留空由模型按人设推断
- 角色图等比缩放到 256px 存成圆形头像

**对话**
- 每个角色独立保存聊天记录（浏览器 `localStorage`）
- 流式回复，实时看到角色在说
- 顶栏**模型选择器**：列出当前部署注册的所有 provider / 模型，选择会记住；不选就用「设置 → 模型」的默认值
- 回车发送，Shift+回车换行，中文输入法组词时不会误发

**回复操作**
- 每条角色回复下方有胶囊：**继续说**（让角色顺着自己的情绪往下讲，适合不知道怎么接的时候）、**重写**（丢掉这条，用同样上下文重新生成）
- 悬停任意消息出现 **↩**：回溯到那一轮，删掉该条及其之后的内容
- 顶栏「从开场白开始」：一键回到开头
- 输入框右上方胶囊：滚到中间显示「回到顶部」，滚到顶部变「回到当前」（跳回最近一轮），停在底部时隐藏

## 安装

需要 DSH 已装好。

```sh
git clone https://github.com/<your-name>/dsh-role-play.git
```

然后在 DSH 里用 Plugin Manager 安装这个目录：

```js
pluginManager.install_bundle({ action: 'install_bundle', target: '<仓库绝对路径>' })
```

装完 **完全退出 DSH 再打开**（Host 侧代码要重启才加载；之后改 `client.js` 通常刷新页面即可）。

进入任意会话，在视图栏选 **「角色扮演」**。

### Windows 跨盘符注意

若仓库与 DSH profile 不在同一个盘（例如仓库在 `D:\`，profile 在 `C:\Users\...\.dsh`），pnpm 会生成失效的相对符号链接，表现为安装成功但插件解析不到。把 profile 里的链接换成 junction：

```powershell
$link = "$env:DSH_PROFILE_DIR\node_modules\dsh-role-play"
(Get-Item $link).Delete()
New-Item -ItemType Junction -Path $link -Value "<仓库绝对路径>"
```

## 使用

1. 点「+ 新建角色」，填名字、导一张图、写人设和开场白
2. 顶栏选模型
3. 开始聊

「角色想要什么 / 角色在防备什么」是可选的，但填了之后剧情张力会明显更好——模型有了明确的动机和阻力，而不是泛泛地友善。

## 结构

```
index.js            Host 半部：注册 /rp-chat/api/* 路由，转发到 DSH 的 llm 服务做流式补全
client.js           Client 半部：conversation.view 里的「角色扮演」视图
cordis.patch.yml    Bundle patch：插入 roleplay-chat 这一行插件
locale/en.json      插件管理页的英文标题与描述
locale/zh.json      中文标题与描述
icon.svg            插件图标
```

### 接口

| 路由 | 说明 |
|---|---|
| `GET /rp-chat/api/model` | 返回模型清单与默认选择：`{ default, options: [{ provider, model, name? }] }` |
| `POST /rp-chat/api/chat` | 流式补全。请求体 `{ system, messages: [{ role, text }], provider?, model?, temperature?, maxTokens? }`，SSE 响应：`{"type":"delta","text":"…"}`、`{"type":"done"}`、`{"type":"error","message":"…"}` |

路由有同源校验（拒绝 `Origin` 与 `Host` 不符的请求）。

## 数据存放

角色卡（含头像 data URL）、聊天记录、当前角色、当前模型全部存在浏览器 `localStorage`，键名前缀 `rpChat.`。插件本身不写任何文件。

## 已知限制

- 聊天记录只在浏览器本地，不参与 DSH 的会话日志与 fork / replay
- 角色图以 PNG 存进 `localStorage`，图多时占配额（浏览器通常限 5～10 MB）
- 界面文案固定中文；仅插件管理页的标题 / 描述是双语
- 依赖宿主的 `llm` 与 `webServer` 服务，缺任意一个都不会激活

## 许可证

MIT
