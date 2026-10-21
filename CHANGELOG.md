# 更新日志

## v0.1.0 · 2026-10-21

MaPU Omni（码炉）首个版本，提供面向 MaPU Scale 编程的本地网页版 Agent 工作空间。

### 主要功能

- 管理本地工作空间与对话，通过真实 Cursor CLI 执行任务，支持模型选择、Agent / Ask / Plan 模式、会话恢复和停止任务。
- 实时展示回复、执行日志与进程状态，项目、对话与设置在本地保存。
- 支持自定义 Harness，包含通用 AGENTS.md、Scale Multi-Lang、Scale Forge、Scale CUDA 和 MaPU MicroCode 类型；支持检测、搜索、编辑和删除。
- 为 Harness 提供资源快照、项目记忆和运行结果隔离，防止过期设置覆盖新的 Harness 配置。
- 回复以 Markdown 预览显示，支持标题、列表、表格、引用、链接和代码块，并清理生成的 HTML。
- 支持调整侧栏宽度、字体大小和用户名称；对话内容宽度可选 740 / 960 / 1200 / 1440 px 或填满可用宽度，默认 960 px。

### 运行与验证

- 需要 Node.js 22+ 和已登录的 Cursor CLI；无需安装 npm 依赖，运行 `npm start` 后访问 `http://127.0.0.1:4317`。
- `npm test` 的 9 项测试通过，覆盖 CLI 执行、会话与设置持久化、权限校验及 Harness 隔离；Markdown 预览与宽度保存已完成浏览器验证。
