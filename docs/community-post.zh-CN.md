# DSH | dsh-pptx-viewer | 通过对话编辑 PowerPoint 演示文稿

[English](community-post.md) · [简体中文](community-post.zh-CN.md)

> 非官方项目，由社区成员独立开发和维护，与 DeepSeek 无隶属关系，也不代表官方推荐。

[项目与源码](https://github.com/yunfeizhu/dsh-pptx-viewer) ·
[0.1.0 版本](https://github.com/yunfeizhu/dsh-pptx-viewer/releases/tag/v0.1.0) ·
[使用说明](https://github.com/yunfeizhu/dsh-pptx-viewer/blob/main/docs/usage.zh-CN.md)

## 能做什么

在 DSH Web 对话中发送一个 `.pptx`
附件，演示文稿会在右侧打开。既可以使用完整编辑器，也可以直接向 Agent 提出修改需求，例如：

- “在末尾新增一页，标题写下一步计划。”
- “把第三页标题居中，字体改成蓝色。”
- “把第二行的分数改成 42。”
- “把我上传的图片放到这一页。”

**0.1.0**
支持新增和管理幻灯片、文字与段落格式、元素对齐、形状、表格、六类图表、上传的图片，以及撤销与重做。修改会直接显示，无需额外点击确认应用。

![编辑器展示合成演示文稿中新增的一页](https://raw.githubusercontent.com/yunfeizhu/dsh-pptx-viewer/main/docs/assets/editor-example.png)

_编辑器示例：浏览器回归测试使用的合成演示文稿。_

## 安装

先安装 Node 24 并配置 DeepSeek Harness：

```sh
dsh plugin --profile web add dsh-pptx-viewer@0.1.0
dsh web
```

如果 DSH 已在运行，请先保存文稿再重启。在 Chrome 或 Edge 中打开 DSH 输出的登录链接。安装包包含构建产物，不需要用户自行构建，也不需要单独配置模型密钥。已测试 DSH
CLI `0.1.5-rc.1`、DSH 公开插件包 `0.1.5-rc.2` 和 `pptx-react-viewer` `3.18.0`。

## 如何接入 DSH，以及当前边界

插件通过 DSH 公开插件接口注册右侧页签和对话工具，在附件消息被接收后打开 PPTX。编辑器与 Agent 共用当前文稿和撤销历史，使用 DSH 对话中选定的模型，无需修改 DSH 源码。

- 组件的**保存**按钮下载 PPTX；**自动保存**保留浏览器恢复副本，不会覆盖本机原文件。
- 附件读取限定在当前对话已接收的文件。工具读取的文稿文字和结构化数据可能进入当前配置的模型服务商。
- 当前没有普通附件卡片点击扩展接口；可以从侧栏打开，或通过对话说“重新打开右侧的 PPTX”。
- 动画、母版和主题等缺少公开接口的能力尚未接入对话。导入图表与复杂格式也有明确的[能力边界](https://github.com/yunfeizhu/dsh-pptx-viewer/blob/main/docs/capabilities.zh-CN.md)。

欢迎在 [Issues](https://github.com/yunfeizhu/dsh-pptx-viewer/issues)
反馈问题和可复现示例。请使用合成或脱敏文稿，避免提交私人内容。
