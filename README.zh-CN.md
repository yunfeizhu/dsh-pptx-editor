<p align="center">
  <img src="https://raw.githubusercontent.com/yunfeizhu/dsh-pptx-editor/main/docs/assets/dsh-pptx-editor-banner.png" alt="连接对话、演示文稿编辑器与幻灯片的概念插画" width="1200">
</p>

<h1 align="center">dsh-pptx-editor</h1>

<p align="center">在 DeepSeek Harness 中，用对话编辑 PowerPoint 幻灯片。</p>

<p align="center">
  <a href="https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/README.md">English</a> ·
  <a href="https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-pptx-editor"><img src="https://img.shields.io/npm/v/dsh-pptx-editor" alt="npm version"></a>
  <a href="https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/.node-version"><img src="https://img.shields.io/badge/Node.js-24-5FA04E" alt="Node.js 24"></a>
  <a href="https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0"></a>
</p>

[快速开始](#快速开始) · [功能](#支持哪些操作) · [对话示例](#试着这样说) ·
[保存](#保存与恢复) · [文档](#文档与反馈)

发送一个 `.pptx`
附件，在对话旁打开演示文稿，再说出想修改的内容。插件将 DSH 的 Agent 与完整的演示文稿编辑器连接起来：你可以在同一份文稿中交替使用对话和手动编辑，修改即时可见。

## 实际效果

![DSH 对话修改标题，右侧编辑器即时显示修改结果](https://raw.githubusercontent.com/yunfeizhu/dsh-pptx-editor/main/docs/assets/conversation-editing.png)

_使用合成演示文稿截取的真实 DSH 对话，标题修改直接显示在右侧编辑器中。_

## 快速开始

需要 **Node 24**、已配置好的 **DeepSeek Harness**，以及较新版本的
**Chrome 或 Edge**。将预构建的 npm 包安装到 Web 配置中：

```sh
dsh plugin --profile web add dsh-pptx-editor@1.0.0
dsh web
```

1. 在浏览器中打开 **DSH 输出的登录链接**。
2. 新建对话，附加一个 `.pptx` 文件（最大 **50
   MiB**），并发送需求，例如“预览这个演示文稿”。
3. 说出修改要求。文稿会在右侧栏打开，修改也会直接显示在那里。
4. 需要下载编辑结果时，点击编辑器内的**保存**按钮。

插件使用 DSH 对话中选择的模型，无需额外配置模型密钥。如果 DSH
Web 已经运行，请先保存打开的文稿，再重启服务以加载插件。不要同时加载 npm 安装包和源码补丁。

已验证宿主：DSH CLI `0.1.5-rc.1`，公共插件包 `0.1.5-rc.2`，在本机 `127.0.0.1`
上运行。版本详情、本地安装包、更新与卸载方式见[安装指南](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/docs/usage.zh-CN.md)。

## 支持哪些操作

| 类别   | 可通过对话完成的操作                                                   |
| ------ | ---------------------------------------------------------------------- |
| 幻灯片 | 新增、复制、重排、隐藏、删除和切换页面                                 |
| 文字   | 改写内容；修改字体、字号、颜色、加粗、斜体和下划线                     |
| 段落   | 水平与垂直对齐、间距、缩进、项目符号和编号列表                         |
| 布局   | 移动、缩放、旋转、翻转、对齐和均匀分布元素                             |
| 形状   | 插入基本形状，修改填充与轮廓，复制或删除元素                           |
| 表格   | 插入表格，修改单元格内容与格式，调整行列尺寸和未合并表格结构           |
| 图表   | 插入柱形／条形、折线、饼图、环形、面积和雷达图；修改受支持的数据与样式 |
| 图片   | 插入上传的图片，裁剪或调整透明度、亮度和对比度                         |
| 历史   | 撤销、重做，或通过对话重新打开演示文稿                                 |

你仍然可以直接操作原生编辑器。对话修改与手动操作使用同一份文稿和编辑历史；连续多条工具命令**不会合并成一次原子撤销**。使用
`edit_pptx_batch`：一次修改最多 100 个跨页现有元素，只占一步撤销。

![包含可编辑表格和图表的演示文稿](https://raw.githubusercontent.com/yunfeizhu/dsh-pptx-editor/main/docs/assets/tables-and-charts.png)

_原生编辑器中的表格、图表与幻灯片预览。截图使用合成内容，不代表所有 PowerPoint 文件都能完全一致地渲染。_

## 试着这样说

先发送 PPTX 附件，然后每次提出一个要求：

| 目标     | 对话示例                                      |
| -------- | --------------------------------------------- |
| 改标题   | “把第一页标题改成‘季度复盘’。”                |
| 新增页面 | “在最后新增一张空白幻灯片。”                  |
| 添加文字 | “在第三页添加文本框，内容为‘下一步计划’。”    |
| 段落格式 | “将第三页标题文本框里的段落居中。”            |
| 修改表格 | “把第二页表格里的 Q2 目标改成 35。”           |
| 修改图表 | “把第二页图表 Growth 系列的 Q2 数值改成 35。” |
| 插入图片 | 上传图片后说：“把上传的图片插入第三页。”      |
| 重新打开 | “重新打开右侧的 PPTX。”                       |
| 撤销     | “撤销刚才的修改。”                            |

支持最大 **1 MiB**
的 PNG、JPEG、WebP 和 GIF 图片附件。插入图片时使用同一对话中的附件。更多示例与操作限制见[使用指南](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/docs/usage.zh-CN.md)。

## 保存与恢复

> **自动保存只是当前浏览器中的本地恢复缓存（IndexedDB），不会自动写入或覆盖
> `.pptx` 文件。**
> 编辑器显示“已保存到此电脑”时，指的是这份浏览器恢复副本。需要保留或分享文件，请点击**保存**下载 PPTX。

| 操作                   | 保存到哪里             | 实际效果                                               |
| ---------------------- | ---------------------- | ------------------------------------------------------ |
| 编辑器内的**保存**     | 下载为 `.pptx` 文件    | 用于保留或分享编辑结果，不会覆盖上传的附件或本机原文件 |
| 编辑器内的**自动保存** | 当前浏览器中的恢复副本 | 在同一对话重新打开同一来源的文件时，可按提示恢复       |

开启自动保存后，插件每两秒检查变化并记录恢复快照。恢复提示覆盖最近 24 小时的副本；副本依赖浏览器存储，不恢复撤销历史，清理浏览器数据会移除副本。如果最新快照尚未完成就刷新，仍可能丢失最后一次修改。**需要长期保留或分享时，请下载 PPTX 文件。**

关闭 PPTX 页签后，编辑器仍保留在内存中，供再次打开。用户主动关闭的页签不会在刷新后自行打开，需要时可通过对话恢复。完整行为见[恢复与故障排查](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/docs/usage.zh-CN.md)。

## 适用范围与限制

- 这是面向 **DSH
  Web 的 PPTX 附件编辑插件**。从已有附件开始，无需在右侧“开始”页再设置独立入口。
- 动画、切换效果、主题／母版、演讲者备注与批注尚未接入对话操作；部分原生界面功能没有可供插件使用的编辑接口。
- 复杂图表、合并表格结构、局部字符格式和部分图片效果仍有限制。不能保证任意导入文件无损往返，详情见[能力矩阵](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/docs/capabilities.zh-CN.md)。
- Agent 可以读取幻灯片文字、格式及受支持的表格／图表数据。这些内容会进入 DSH 对话，并可能发送给其配置的模型服务商，详见[数据处理说明](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/docs/usage.zh-CN.md)。

## 常见问题

**为什么选好附件后没有打开？**

需要先发送消息。插件根据 DSH 已接收的消息打开文稿，而非文件选择动作；建议每条消息只附加一个 PPTX。

**“已保存”是不是覆盖了原文件？**

不是。自动保存用于浏览器恢复，保存按钮用于下载 PPTX，两者都不会覆盖原附件或本机原文件。

**还能用鼠标和键盘编辑吗？**

可以。手动修改与 Agent 修改使用同一份打开的文稿，也可以使用编辑器原生的撤销、重做按钮。

**界面语言怎么选择？**

跟随 DSH 的英文或简体中文设置，其他语言回退为英文。插件没有单独的语言切换入口。

## 文档与反馈

- [安装、使用与故障排查](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/docs/usage.zh-CN.md)
- [对话能力矩阵](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/docs/capabilities.zh-CN.md)
- [报告问题或提出功能需求](https://github.com/yunfeizhu/dsh-pptx-editor/issues/new/choose)
- [DSH 社区讨论](https://github.com/deepseek-ai/deepseek-harness/discussions/6854)
- [版本记录](https://github.com/yunfeizhu/dsh-pptx-editor/releases)
- [贡献指南](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/CONTRIBUTING.zh-CN.md)
  ·
  [行为准则](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/CODE_OF_CONDUCT.zh-CN.md)
  ·
  [安全政策](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/SECURITY.zh-CN.md)

反馈问题时请提供插件、DSH、浏览器版本和最小复现步骤，必要时使用不含敏感信息的示例文件。请勿在公开 Issue 中上传私人文稿或凭证。

## 本地开发

环境版本见 `.node-version` 和 `package.json`：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

[开发说明](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/docs/development.md)区分了单元测试、浏览器验证与真实 DSH 对话验证。提交 PR 前请阅读[贡献指南](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/CONTRIBUTING.zh-CN.md)。

## 致谢与协议

- 感谢 [DeepSeek 团队（@deepseek-ai）](https://github.com/deepseek-ai)开源
  [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，提供插件宿主与对话环境。
- 感谢 Christopher van
  Rooyen（[@ChristopherVR](https://github.com/ChristopherVR)）及
  [pptx-viewer](https://github.com/ChristopherVR/pptx-viewer)
  的贡献者，提供 PPTX 编辑与渲染引擎。

采用
[Apache License 2.0](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/LICENSE)。第三方许可信息见
[THIRD_PARTY_NOTICES.md](https://github.com/yunfeizhu/dsh-pptx-editor/blob/main/THIRD_PARTY_NOTICES.md)。
