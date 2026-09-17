# Documentation artwork

The README banner is an illustrative concept, not a screenshot of implemented
plugin functionality. It is shared by both language editions and contains no
text. Each README supplies a localized alternative description.

Asset: [dsh-pptx-viewer-banner.png](dsh-pptx-viewer-banner.png).

Created with the built-in `image_gen` tool. Harapter's banner informed the pale
blue glass illustration style; the generated scene belongs to this project's
conversation-to-presentation concept.

## Generation prompt

```text
Create a brand-new 3:1 ultrawide GitHub README banner for dsh-pptx-viewer, an upcoming conversational PPTX editing plugin. No text, no letters, no logos, no watermark. Elegant high-key isometric 3D illustration on an almost-white icy blue background with very faint circular technical grid. Central subject: a large floating translucent glass presentation slide panel, showing a simple purple bar chart and a few blue rectangular content blocks, above a layered round ceramic-and-glass pedestal. To its left a smaller translucent chat-bubble cluster on its own low round pedestal; to its right a short stack of glass presentation slides on another pedestal. Thin gently flowing cyan and periwinkle luminous lines connect the chat bubbles through the main panel to the slide stack. Airy blue-white, pale indigo and glass materials, subtle reflections, refined architectural model rendering, soft ambient studio light, quiet premium open-source developer tooling aesthetic. Generous uncluttered whitespace, ultra crisp edges, balanced panoramic composition, no actual app screenshot and no claims of finished functionality. The composition should read as conversation flowing into presentation editing. Wide banner ideally 2400x800.
```

## Product screenshots

- [conversation-editing.png](conversation-editing.png): a real DSH conversation
  changing the first slide's title in the right-hand editor.
- [tables-and-charts.png](tables-and-charts.png): separate conversation requests
  changing a table cell and a chart data point on slide two.
- [editor-example.png](editor-example.png): the synthetic slide-insertion
  browser regression fixture, captured in the editor test host.

The first two images were captured in Chrome on 2026-09-17 from the running
plugin with `pptx-react-viewer` 3.18.0, before the dependency update. They use
only the public synthetic fixture from `tests/e2e/fixture.mjs`, with one change
per message, and do not depict private presentations. The English and Chinese
READMEs share these Chinese-interface screenshots with localized captions. These
captures demonstrate the existing conversation flow; they are separate from the
automated compatibility checks for subsequent component updates.
