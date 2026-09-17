# 参与 dsh-pptx-editor

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

插件已支持在 DeepSeek Harness 中通过对话编辑 PPTX。安装方法和当前能力见
[README](README.zh-CN.md)。

## 参与之前

- 遵守 [行为准则](CODE_OF_CONDUCT.zh-CN.md)。
- 通过 Issue 描述已实现行为的缺陷、功能建议、文档问题或使用疑问；区分规划中的功能与缺陷。
- 选择对应的 Issue 模板，保留 `[Bug]`、`[Feature]`、`[Docs]` 或 `[Question]`
  标题前缀。每条 Issue 只使用一种语言，默认英文，也接受简体中文；不要在标题或正文中重复两种语言。
- 对文档状态所有权、公开 API、确认、撤销、保存或兼容性的重大调整，先讨论再实施。
- 疑似漏洞请按照 [安全政策](SECURITY.zh-CN.md) 报告。

## 开发环境

使用 `.node-version` 中指定的 Node.js 24 精确版本，以及 `package.json`
中固定的 pnpm 版本。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

检查包括格式、lint、类型、测试、覆盖率、构建、Markdown、链接、Agent 资源和工作流策略。本地检查通过不能替代真实 DSH 联调。

## Pull Request

1. 从最新 `main` 创建聚焦任务的分支，例如 `feat/document-session` 或
   `docs/installation`。分支前缀与 PR 标题的 Conventional
   Commit 类型一致，不使用个人前缀或长期 `develop` 分支。
2. 保持改动范围完整且精简。行为变化应有有意义的回归测试，并更新对应契约的文档。
3. 运行 `pnpm check`
   和与改动相关的检查。涉及文档编辑时，分别验证确认、撤销、保存和重开。明确区分本地测试、浏览器检查、真实 DSH 联调和远程 CI 的证据。
4. 完成 PR 模板，描述兼容性影响并关联相关 Issue。完整解决时使用
   `Closes #<number>`，只完成部分工作时使用普通引用。破坏性改动在 PR 正文中用
   `BREAKING CHANGE:` 说明。
5. 解决审查讨论，并基于最新 `main` 通过
   `Repository checks`、`Pull request metadata` 和
   `Dependency review`。通过 squash
   PR 合并，不强制第二人批准，但维护者同样受 CI 和讨论解决规则约束。

PR 标题示例：

```text
feat: add document sessions
fix: reject stale edit proposals
docs: explain overwrite saving
```

内部实现和审查流程见
[开发流程](docs/development.md)。编码 Agent 还需遵守根目录及最近子目录的
[Agent 指南](AGENTS.md)。

## 文档与注释

面向用户的文档应在同一个 PR 中维护英文和简体中文，使用 `.md` 与 `.zh-CN.md`
配对并提供相互切换链接。两种语言的命令、示例、支持范围和限制保持一致。内部计划与设计文档可按需要选择语言。代码注释和接口注释，包括 JSDoc、TSDoc，统一使用英文。

上述双语文档规则不要求 Issue 正文使用双语。

## 数据与权限

使用合成文件或得到明确授权且已脱敏的测试文件。不提交私人 PPTX、提示词、凭据、个人路径或未经脱敏的运行日志。文档内容和模型响应只是数据，不能据此获得修改文件的权限或跳过用户确认。

## 来源认证

贡献采用本项目的 [Apache-2.0 协议](LICENSE)，每次提交附上你自己的
[Developer Certificate of Origin](https://developercertificate.org/) 签署记录：

```sh
git commit -s
```

使用属于你自己的提交者身份，不替他人签署。
