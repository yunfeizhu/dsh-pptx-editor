# DSH | dsh-pptx-viewer | Edit PowerPoint presentations through conversation

[English](community-post.md) · [简体中文](community-post.zh-CN.md)

> Unofficial project, independently developed and maintained by a community
> member. Not affiliated with or endorsed by DeepSeek.

[Project and source](https://github.com/yunfeizhu/dsh-pptx-viewer) ·
[0.1.0 release](https://github.com/yunfeizhu/dsh-pptx-viewer/releases/tag/v0.1.0)
· [Usage](https://github.com/yunfeizhu/dsh-pptx-viewer/blob/main/docs/usage.md)

## What it does

Send a `.pptx` attachment in a DSH Web conversation. The presentation opens in
the right sidebar, where you can use the full editor or ask the Agent to change
it. For example:

- “Add a slide at the end titled Next steps.”
- “Center the title on slide 3 and make it blue.”
- “Change the second row's score to 42.”
- “Insert the image I uploaded on this slide.”

Version **0.1.0** supports slide creation and management, text and paragraph
formatting, element alignment, shapes, tables, six chart types, uploaded images,
and undo/redo. Changes appear directly without an extra apply-confirmation step.

![Editor showing a new slide in a synthetic presentation](https://raw.githubusercontent.com/yunfeizhu/dsh-pptx-viewer/main/docs/assets/editor-example.png)

_Editor example from a synthetic presentation used in browser regression._

## Install

With Node 24 and a configured DeepSeek Harness:

```sh
dsh plugin --profile web add dsh-pptx-viewer@0.1.0
dsh web
```

Save open documents before restarting an existing DSH service. Open DSH's login
URL in Chrome or Edge. This is a prebuilt bundle; users do not need to build the
plugin or configure a separate model key. Tested with DSH CLI `0.1.5-rc.1`,
public DSH packages `0.1.5-rc.2`, and `pptx-react-viewer` `3.18.0`.

## DSH integration and current boundaries

The plugin registers a native sidebar tab and conversation tools through DSH's
public plugin APIs. Sent PPTX attachments open through the admitted-message
feed; the editor and Agent share the same document and undo history. It uses the
model selected in the DSH conversation. No DSH source patch is required.

- The viewer's **Save** button downloads a PPTX. **AutoSave** keeps a browser
  recovery copy; it does not overwrite the original file.
- The plugin reads attachments admitted to the current conversation. Document
  text and structured data read by tools can reach the configured model
  provider.
- Native attachment-card clicks are not an extension point; reopen through the
  sidebar or ask “Reopen the PPTX on the right.”
- Animation, master/theme editing and other unavailable public APIs are not
  exposed to conversation. Imported charts and complex formatting have explicit
  [capability limits](https://github.com/yunfeizhu/dsh-pptx-viewer/blob/main/docs/capabilities.md).

Bug reports and reproducible examples are welcome in the
[issue tracker](https://github.com/yunfeizhu/dsh-pptx-viewer/issues). Please use
a synthetic or anonymized presentation rather than private content.
