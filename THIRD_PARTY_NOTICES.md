# Third-party notices / 第三方声明

## Bundled software / 打包的软件

Published packages include `dist/THIRD_PARTY_LICENSES.txt`, generated from the
dependencies actually included by the browser bundler. It contains their full
LICENSE, COPYING and NOTICE files, including the React and ReactDOM notices. The
dependency copyright holders retain their rights; the project's license does not
replace those licenses.

For published dependency tarballs that omit their license file, the build uses
version-specific copies from pinned upstream commits listed in
`scripts/vendor-licenses/sources.json`. Their source URLs are included in the
generated notices. The complete Apache License 2.0 is also included in
`LICENSE`.

发布包中的 `dist/THIRD_PARTY_LICENSES.txt`
根据浏览器构建实际包含的依赖生成，收录完整的 LICENSE、COPYING 和 NOTICE 文件，包括 React 与 ReactDOM 的许可声明。依赖版权归各自权利人所有，本项目协议不替代这些依赖的协议。

部分依赖发布包未附带许可文件，构建时会使用
`scripts/vendor-licenses/sources.json`
中记录的固定上游提交及对应版本的许可副本，并在生成的声明中保留来源链接。完整的 Apache
License 2.0 同时收录于 `LICENSE`。

## pptx-viewer Chinese translations / 中文翻译

English and Simplified Chinese translations are imported from the released
`pptx-react-viewer` package through `i18n` and `i18n/zh-CN`. The dictionaries
come from
[ChristopherVR/pptx-viewer](https://github.com/ChristopherVR/pptx-viewer),
retain upstream copyright, and are licensed under the
[Apache License 2.0](LICENSE). They are bundled unchanged through the public
i18next integration; the package's LICENSE and NOTICE are included in the
generated third-party notices. No separate vendored dictionary is maintained.

英文和简体中文翻译通过已发布的 `pptx-react-viewer` 包的 `i18n` 与 `i18n/zh-CN`
接口导入，来源于
[ChristopherVR/pptx-viewer](https://github.com/ChristopherVR/pptx-viewer)，保留上游版权并遵循
[Apache License 2.0](LICENSE)。词典通过公开的 i18next 集成原样打包，组件的 LICENSE 和 NOTICE 收录在生成的第三方许可文件中。本项目不再单独维护翻译词典副本。
