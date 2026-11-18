dsh-role-play v1.7.0 · GitHub 发布指南
面向仓库 `github.com/zhengwuyu957/dsh-role-play`。
本机没有安装 git，所以下面给了「装 git 的标准路径」和「不装 git 的网页路径」两套，任选一套即可。
---
零、发布前状态确认（已完成，可跳过）
检查项	结果
版本号	`1.7.0`
八套自动化测试	全部通过
`client.js` / `index.js` 语法	通过
`package.json` 的 `files` 字段与实际文件	逐项对上
三份副本一致性	11 个文件 SHA256 全部一致
待发布的 13 个文件（就是 `release-packages\dsh-role-play-v1.7.0-github.zip` 里的内容）：
```
.gitignore
LICENSE
README.md
package.json
index.js
client.js
cordis.patch.yml
icon.svg
RELEASE_NOTES_v1.3.0.md
RELEASE_NOTES_v1.4.0.md
RELEASE_NOTES_v1.7.0.md
locale/zh.json
locale/en.json
```
`node_modules/` 不要传（`.gitignore` 已经排除）。
---
一、这次要发布的内容
相对上一版（1.5.x），1.7.0 的实质变化：
新增角色扮演专用默认模型 — 只影响本插件，不动 DSH 全局默认
成人向描写重做 — 给出器官/行为本名词表 + 身体状态清单 + 「不许拖」
修掉人称自相矛盾 — 2.2 条曾说「指代用户用『她』」，与 2.1 的「一律用你」打架
生成角色卡的 JSON 容错 — 四级兜底解析，坏 JSON 也能救回来
新增 `/rp-chat/api/health` — 只读自检端点
可选的内容策略桥接 — 默认关闭（实测无稳定收益，见发布说明）
---
二、路径 A：装了 git 的话（推荐）
A1. 安装 git（本机当前没有）
任选其一：
官方安装包：https://git-scm.com/download/win
或者用 winget：
```powershell
winget install --id Git.Git -e --source winget
```
装完关掉再重开 PowerShell，验证：
```powershell
git --version
```
A2. 配置身份（只需一次）
```powershell
git config --global user.name  "你的名字"
git config --global user.email "你的GitHub邮箱"
```
A3. 克隆仓库到本地
```powershell
cd D:\DSHData\workspace
git clone https://github.com/zhengwuyu957/dsh-role-play.git repo-dsh-role-play
cd repo-dsh-role-play
```
> 注意：**不要**直接克隆到 `dsh-role-play` 那个目录。那个目录正被 DSH 通过 junction 引用着，
> 在里面塞 `.git` 会让插件目录混进版本控制文件。单独开一个 `repo-dsh-role-play` 更干净。
A4. 覆盖成本次要发布的内容
```powershell
$src = "D:\DSHData\workspace\default-workspace\dsh-role-play"
$dst = "D:\DSHData\workspace\repo-dsh-role-play"

Copy-Item "$src\client.js"     $dst -Force
Copy-Item "$src\index.js"      $dst -Force
Copy-Item "$src\package.json"  $dst -Force
Copy-Item "$src\README.md"     $dst -Force
Copy-Item "$src\cordis.patch.yml" $dst -Force
Copy-Item "$src\icon.svg"      $dst -Force
Copy-Item "$src\LICENSE"       $dst -Force
Copy-Item "$src\.gitignore"    $dst -Force
Copy-Item "$src\RELEASE_NOTES_*.md" $dst -Force
Copy-Item "$src\locale\*"      "$dst\locale" -Force
```
A5. 看一眼改了什么再提交
```powershell
git status
git diff --stat
```
预期会看到 `client.js`、`index.js`、`package.json`、`README.md`、`RELEASE_NOTES_v1.7.0.md`（新增）有改动。
如果 `git status` 里出现 `node_modules/`，先停下来检查 `.gitignore`。
A6. 提交并推送
```powershell
git add -A
git commit -m "release: v1.7.0 - 角色扮演专用默认模型 + 成人向描写重做 + 人称修正"
git push origin main
```
> 如果你的默认分支叫 `master` 而不是 `main`，把最后一句换成 `git push origin master`，
> 或者用 `git branch --show-current` 先确认。
A7. 打标签（GitHub 会把它当作 Release）
```powershell
git tag -a v1.7.0 -m "v1.7.0"
git push origin v1.7.0
```
---
三、路径 B：不想装 git，纯网页操作
B1. 逐个上传文件
打开 https://github.com/zhengwuyu957/dsh-role-play，对每个要改的文件：
点进文件（例如 `client.js`）
右上角 铅笔图标（Edit）
全选删掉原有内容
粘贴新内容（从本地对应文件复制）
底部 Commit changes
`client.js` 有 16 万字符，网页编辑器可能卡顿。更省事的做法：
用 Add file → Upload files，先把整个 `release-packages\_stage_v170` 目录拖进去
上传界面支持拖拽整个文件夹，会自动保留 `locale/` 子目录结构
B2. 新建文件（`RELEASE_NOTES_v1.7.0.md` 是新增的）
Add file → Create new file，文件名填 `RELEASE_NOTES_v1.7.0.md`，把内容粘进去。
B3. 发 Release
https://github.com/zhengwuyu957/dsh-role-play/releases/new
Choose a tag：输入 `v1.7.0` → 选 Create new tag on publish
Release title：`v1.7.0`
Describe this release：把 `RELEASE_NOTES_v1.7.0.md` 的内容整段粘进去
附件可以传 `dsh-role-play-v1.7.0-github.zip`
点 Publish release
---
四、发布后自检
仓库首页 `package.json` 里的 `version` 显示 `1.7.0`
`README.md` 里模型选择器那一段已经写成「角色扮演专用默认模型」
Release 页面存在 `v1.7.0` 标签
别人克隆下来能正常装：
```powershell
git clone https://github.com/zhengwuyu957/dsh-role-play.git
```
然后在 DSH 里装这个目录，完全退出 DSH 再打开（Host 侧要重启才加载）。
---
五、几个容易踩的坑
坑	说明
把 `node_modules` 提交上去	会污染仓库、让 clone 变得很慢。提交前务必 `git status` 看一眼
忘了重启 DSH	改 `index.js` 必须重启；只改 `client.js` 刷新页面就够
跨盘符装不上	仓库和 DSH profile 不在同一分区时，pnpm 的相对符号链接会失效。README 里有 junction 的修法
改了全局默认模型	本次没有改 `agentDefaultModel`。如果你之前手动改过 profile 的 `cordis.patch.yml`，记得那和本次发布无关
发布说明里的负面结论	1.7.0 的说明里写明了「重写为预设」被实测否决的原因。这是有意保留的，建议别删——省得以后又有人走一遍
---
六、这份指南涉及的文件位置
用途	路径
发布用压缩包	`release-packages\dsh-role-play-v1.7.0-github.zip`
解压后的完整文件树	`release-packages\_stage_v170\`
插件工作副本	`dsh-role-play\`
待上传副本	`待上传\dsh-role-play\`
发布副本	`release-dsh-role-play\`
