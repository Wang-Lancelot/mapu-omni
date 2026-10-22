# MaPU Omni · 码炉

当前版本：**v0.1.0**。版本变更见 [CHANGELOG.md](CHANGELOG.md)。

面向 MaPU Scale 编程的本地网页版 Agent 工作空间，中文名「码炉」。通过专用 Harness 承载代码转码、代码优化和微码改写等工作流。浏览器提交 prompt，Node.js 后端在所选项目目录启动真实 Cursor CLI 或 Codex CLI 子进程，实时展示回复及终端日志。

## 启动

需要 Node.js 22+，以及已登录的官方 Cursor CLI 或 Codex CLI。无需安装 npm 依赖。

```sh
agent login
npm start
```

打开 http://127.0.0.1:4317 。已登录对应 CLI 的机器可直接使用。Codex 用户在终端运行 `codex login`，并在设置 → 模型与连接中选择 Codex CLI。登录状态和可用模型可在设置里刷新；此应用不保存 API Key。

## 使用

- 左侧「＋」添加本机目录（绝对路径或 `~/…`），然后创建对话。工作空间左侧箭头可展开所属对话；最近对话按更新时间显示所有工作空间的对话。
- 工作空间和对话右侧「×」可删除，操作前会确认。删除工作空间会一并删除所属对话记录，不会删除磁盘文件；有任务运行时需先停止任务。
- 左侧栏右边缘可拖动调整宽度，刷新后保留；双击边缘恢复默认宽度，也可聚焦边缘后用左右方向键调整。
- 设置按通用、模型与连接、Harness、执行与权限分类；通用中可修改用户显示名称，Harness 中可搜索、添加、编辑和删除自定义集成，数量没有固定上限。
- 设置中可调整界面字体大小（12–20 px），保存后立即应用，重启后保留。
- 回复默认以 Markdown 预览显示，支持标题、列表、表格、引用、链接和代码块。设置 → 通用中可选择对话内容宽度（740 / 960 / 1200 / 1440 px 或填满可用宽度），默认 960 px，回复与输入框一起调整，刷新和重启后保留。
- 输入 prompt，Enter 发送，Shift+Enter 换行；点击停止按钮终止任务。
- 设置中选择 Cursor CLI 或 Codex CLI、模型和执行模式。对话绑定创建时的后端，切换后端后新建对话；旧对话可切回原后端继续。
- Cursor 模型列表来自 `agent --list-models`；Codex 模型列表读取本机 `$CODEX_HOME/models_cache.json`（默认 `~/.codex/models_cache.json`），可能滞后。Codex 的 Auto 不传模型参数，使用 CLI 当前默认配置。也可填写账号支持的自定义模型 ID。保存后，下一条消息通过真实 `--model <id>` 使用该模型；已在运行的任务保持原模型。CLI 返回实际模型时显示在回复上；未返回时仅显示请求模型或 Auto。
- 应用对你选择的工作目录传入 `--trust`，仅适用于当前执行。Agent 可执行任务；Ask / Plan 为只读模式。自动允许工具执行默认关闭，可在设置显式打开 `--force`；关闭时，CLI 权限行为以本机 Cursor 配置为准，非交互执行无法响应交互式审批，需要调整 Cursor 配置或开启该选项。
- Codex 使用 `exec --json` 执行并保存 thread ID。Ask / Plan 始终使用 `read-only` 沙箱；Agent 默认也为只读，开启「自动允许工具执行」后使用 `workspace-write`。非交互运行不弹出审批，沙箱外操作直接失败，不启用绕过沙箱的参数。
- 顶部「终端」显示真实命令、stdout、stderr、工具事件及退出状态，是进程日志面板，不是任意 shell 输入框。
- 多段对话分别使用 Cursor `--resume <session_id>` 或 Codex `exec resume <thread_id>` 维持上下文。运行中可切换项目、创建其他对话，任务继续执行。
- 项目、对话、设置保存在 `.data/workspace.json`，已被 Git 忽略。服务器重启后，先前运行的任务显示为中断。

## 配置与验证

```sh
PORT=4318 npm start
CURSOR_CLI=/absolute/path/to/agent npm start
CODEX_CLI=/absolute/path/to/codex npm start
npm test
```

测试使用独立临时目录和 CLI 测试替身，覆盖项目路径校验、真实子进程传参、模型与会话恢复、取消任务、持久化及跨站请求防护，不消耗模型额度。与 CLI 服务的端到端执行需要有效登录和网络。

应用仅监听 `127.0.0.1`，校验 Host/Origin，不开放跨域访问；prompt 作为参数直接传入子进程，不拼接 shell。这个架构需要本地文件系统和进程能力，不能直接部署到不支持子进程的静态网站或 Cloudflare Workers。

官方 CLI 参考：https://cursor.com/docs/cli/overview

Codex 接入遵循 [OpenAI Docs 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)。

## 自定义 Harness

Codex 复用现有 Harness 资源快照、项目记忆及运行环境，通过本次调用的 developer instructions 和资源索引按需读取 AGENTS.md、Skills 与角色正文；不将 Cursor 插件参数传给 Codex，也不将角色文件视为已注册的原生子代理。下文关于 Cursor 插件注册与工具映射的说明适用于 Cursor 后端。

在「设置 → Harness」点击「＋ 添加 Harness」，填写名称、类型和本地目录，再点击「保存设置」。支持任意数量；配置随设置保存，刷新或重启后保留。未填写目录的条目可保存，但不能用于新对话。取消或关闭设置会放弃本次修改。

- **通用 · AGENTS.md**：适合自定义工作流。使用专用目录，根目录必须包含非空 `AGENTS.md`；可附带 `skills/**/SKILL.md`、`agents/*.md` 和文档、脚本等资源。Skills 和角色需包含 frontmatter。资源被复制到版本快照，入口规则和 Skills、角色通过 Cursor 插件加载，执行目录仍为当前项目。不会自动把 Codex、Claude 等其他宿主专用工具转换成 Cursor 工具。
- **Scale · Multi-Lang**：使用现有 Scale 适配器，目录要求与 MPUCPorter 一致。
- **Scale · Forge**：适用于 `scale_forge`（例如命名为 MPUCOpt）。仅快照根规则、Skills、知识、工具、工作流与文档，不复制原工程的源码、目标代码、状态和运行产物。当前工程需具备自己的 Forge 状态和写入工具；缺少 `state/project_manifest.json` 时应先确定工作流并初始化，不能继承原仓库的项目进度。快照工具只用于只读知识检索，写状态与验收必须使用当前工程部署的工具。
- **Scale · CUDA**：适用于 `aiKnowledge`（例如命名为 MPUCAgent）。按 `START_HERE.md`、命令索引与知识索引加载 CUDA → SCALE 转译规程。命令属于 playbook，非 shell 命令或宿主原生斜杠命令。仅快照可复用资源及空项目模板；项目配置保存到 `.data/harness-memory/<工作空间ID>/projects/<工作空间ID>/project.yaml`，SPEC、REPORT 与验证产物保留在当前工程任务目录。
- **MaPU · MicroCode**：适用于 `microcode-harness/microcode`（例如命名为 MicroCode）。按 HPP routing Skill 加载微码开发规则，注册嵌套 Skills，快照版本以 `version.json` 为准。Python 使用快照内的 `lib/`；运行结果通过 `HPP_RESULTS_ROOT` 隔离到 `.data/harness-memory/<工作空间ID>/microcode/results/`。本机环境配置、MCStudio、许可证和历史运行结果不复制；真实编译、数值及周期验收仍需当前环境支持。
- 「检测 Harness」检查当前条目的目录与资源；搜索按名称筛选。所有条目（包括 MPUCPorter）均可修改名称、类型和路径，也可删除，点击保存后生效；磁盘上的源文件和已有聊天记录会保留。系统不保留内置 Harness，列表可以为空。旧版 MPUCPorter 配置会一次性迁移为普通条目，删除后重启不会重新出现。
- 已有对话绑定原 Harness。删除条目后需选择其他 Harness 开始新对话；修改类型、路径或资源后不能继续复用旧会话。切换 Harness 会保留输入草稿并开启新对话。
- 通用快照不包含 `.git`、`node_modules`、`.data`、Python 环境、构建目录或缓存，不支持符号链接。不要将整个工程或个人主目录作为 Harness 目录。

## MPUCPorter Harness

添加 MPUCPorter 后，任意工作空间都可以在输入框底部选择 **无 / MPUCPorter**。MPUCPorter 对应外部 `scale_agent` 仓库；在设置里填写根目录（包含 `AGENTS.md` 和 `scale-agent/`），支持相对 MaPU Omni 根目录的路径，例如 `../scale_agent`，也支持绝对路径和 `~/…`。点击「检测 Harness」检查必需资源，保存后生效。新安装不自动添加 Harness；可手动添加，类型选择 **Scale · Multi-Lang**，留空路径可停用。

- **无**：使用原有 CLI 流程，不传入 MPUCPorter 的插件和附加目录，也不注入其运行配置。
- **MPUCPorter**：Cursor 的 cwd 始终是当前真实项目目录。通过 `--plugin-dir` 加载 Cursor 原生插件，注册六个 Skills、根规则与两个审核角色；`--add-dir` 提供 Harness、快照和记忆目录访问。
- 每次用户消息显式要求重读 Harness 入口，按需加载知识，不把整库塞进 prompt。源规则中的 Codex `collaboration.spawn_agent` 映射为 Cursor 的实际原生子代理能力。审核员适配文件包含只读权限；资源可发现不等于已实际执行审核，模型必须如实记录执行结果。
- 适配器在 `.data/harness-adapters/` 保存按内容指纹隔离的资源快照，转换 Cursor 的组件声明和相对链接；不会安装全局 Skills 或改写外部 Harness 源文件。适配文件属于运行派生数据，源资源保持原有目录结构。
- Harness 中的 `projects/<工程>/` 映射到 `.data/harness-memory/<工作空间ID>/projects/<工作空间ID>/`。源代码、测试、构建输出仍在实际工程；记忆初始化使用该工程的绝对 `--code-root`。纯知识查询不创建记忆项目。
- Harness 选择固定在对话上；切换时进入新对话，草稿中的用户输入保留。旧对话可继续查看和恢复原选择。Harness 路径、资源指纹或适配器版本变化后，服务会拒绝继续复用旧 Cursor 会话，提示新建对话。
- 终端显示 Harness 版本、指纹、真实工作目录和记忆位置；回复标注 MPUCPorter。源码与快照的“只读使用”要求属于工作流指令，进程文件访问仍由 Cursor 本机权限及沙箱设置管理。

知识脚本需要 Python 3.9+ 与 PyYAML。Ask / Plan 下部分 shell 操作可能被 Cursor 拒绝，这是 CLI 权限行为；需要运行检索脚本时使用合适的执行模式及现有权限配置。UI 不会因为选择 Harness 自动打开 `--force`。

Markdown 预览使用本地随附的 Marked 18.1.1 与 DOMPurify 3.4.17（`public/vendor/`，许可证随文件保留），无需外部 CDN 或 npm 安装。模型生成的 HTML 经过白名单清理后再显示。

## 许可证

本项目采用 [MIT License](LICENSE)，允许商用、修改、分发和闭源使用，使用或分发时需保留版权声明及许可证文本。

随附的 Marked、DOMPurify 和 Lucide 图标遵循各自许可证，分别见 `public/vendor/marked.LICENSE`、`public/vendor/purify.LICENSE` 和 `public/icons/LUCIDE-LICENSE`。外部 Cursor CLI、Codex CLI 和用户配置的 Harness 遵循各自的许可与服务条款。
