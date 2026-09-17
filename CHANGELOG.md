# Changelog

## 1.0.0 (2026-09-17)

### English

- Rename the project and package to `dsh-pptx-editor`.
- Provide prebuilt installation packages on npm and GitHub Releases.
- Install with `dsh plugin --profile web add dsh-pptx-editor@1.0.0`.

### 简体中文

- 项目和插件包统一更名为 `dsh-pptx-editor`。
- 在 npm 和 GitHub Releases 提供预构建安装包。
- 使用 `dsh plugin --profile web add dsh-pptx-editor@1.0.0` 安装。

## 0.2.0

### English

- Add `edit_pptx_batch` for up to 100 existing elements across slides, with
  whole-batch validation and one undo step through the public editing API.
- Upgrade `pptx-react-viewer` to 3.19.2 and use its published Chinese locale.
- Prevent serialization metadata from creating redundant undo steps after
  AutoSave, navigation or insertion of new content.
- Expand bilingual onboarding with real synthetic conversation screenshots,
  examples and the distinction between browser AutoSave recovery and file saves.
- Publish the verified main-CI package through npm trusted publishing without
  rebuilding, and separate PR metadata checks from code regression.

### 简体中文

- 新增
  `edit_pptx_batch`，通过公开编辑接口一次修改最多 100 个跨页现有元素，整批校验且只占一步撤销。
- 将 `pptx-react-viewer` 升级到 3.19.2，并使用组件已发布的中文语言包。
- 修复自动保存、翻页或插入新内容后，序列化元数据产生多余撤销步骤的问题。
- 丰富中英文入门文档，加入真实合成文稿对话截图、示例，并明确浏览器自动保存恢复与文件保存的区别。
- 通过 npm 可信发布直接发布主分支 CI 已验证的安装包，无需重新构建；PR 元数据检查与代码回归分开运行。

## 0.1.1

### English

- Match the closed-document recovery notice to DSH's language and theme, with
  compact controls to continue editing, hide the notice, or explicitly discard.
- Keep retained-document controls working when an older client hands ownership
  to a newly loaded client.
- Remove the redundant PPTX entry from the sidebar Start page; chat attachments
  and conversation requests continue to open the editor.
- Clarify single-language Issue templates and automatic closure references.

### 简体中文

- 关闭文稿后的恢复提示跟随 DSH 的语言和主题，提供紧凑的继续编辑、隐藏提示和明确丢弃操作。
- 修复旧客户端向新客户端交接时保留文稿的操作控件失效的问题。
- 移除侧栏开始页重复的 PPTX 入口，继续通过聊天附件和对话请求打开编辑器。
- 明确 Issue 按模板使用单一语言，以及通过 PR 关联自动关闭的约定。

## 0.1.0

### English

- Open a sent PPTX attachment beside a DSH conversation and edit it with natural
  language or the full editor.
- Add and manage slides, text, shapes, tables, charts and uploaded images;
  change formatting and alignment, and use shared undo/redo.
- Retain the editor across panel changes and offer browser AutoSave recovery
  after a reload. Download the edited PPTX with the viewer's Save button.
- Follow DSH's language and provide Chinese and English documentation.
- Distribute a prebuilt DSH bundle with authenticated, conversation-scoped
  attachment access. See the
  [capability limits](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/docs/capabilities.md).

### 简体中文

- 在 DSH 对话旁打开已发送的 PPTX 附件，通过自然语言或完整编辑器修改。
- 新增和管理幻灯片、文本、形状、表格、图表及上传的图片；修改格式和对齐，共用撤销与重做。
- 切换面板时保留编辑器，刷新后提供浏览器自动保存恢复；通过组件保存按钮下载编辑后的 PPTX。
- 跟随 DSH 的语言，提供中英文文档。
- 提供预先构建的 DSH 安装包，附件读取经过身份校验并限定在当前对话。详见[能力边界](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/docs/capabilities.zh-CN.md)。
