# 听力理解（quizforge.listening）

支持不限次数播放、倍速下拉选择和前后 15 秒。每次打开播放器默认 1 倍速，点击倒三角展开列表，选择后自动收起并显示所选倍速。作者页支持本地音频导入，自动转成 16 kHz / 40 kbps 单声道 MP3，带进度和取消操作。单段最长 3 分钟，原文件最多 32 MiB，压缩结果最多 1 MiB。原文件不会修改。

导入音频直接随本题保存，不修改共享拓展；切题、重开、导出题库和历史快照均保留音频。使用步骤见 core/docs/guides/LISTENING_GUIDE.md。

旧题库的 playLimit 和旧答案的 plays 字段保留兼容，但已忽略；作者页不再提供次数上限设置。

## 构建

生成源码保存在 core/scripts/build/listening/，不依赖其他盘符的文件。修改后执行：

    npm --prefix core ci
    npm --prefix core run build:listening

不要直接编辑生成的 practice.js、editor.js、rules.js 和 practice.css。MP3 编码器只加入作者页，练习页不加载。第三方许可及替换方法见 THIRD_PARTY.md 和 LICENSE.lamejs.txt。

## 验证

    node --import ./core/scripts/test/test-environment.mjs --test core/test/extensions/listening.test.mjs core/server/host/extensions/extension-packages.test.mjs core/test/desktop/basic-content.test.mjs

## 音频数据

题目 audio 字段可使用 manifest.assets 中声明的静态路径，或作者页生成的 data:audio/mpeg;base64,...。内嵌 MP3 校验固定 MIME、内容头和 1 MiB 上限，不允许外部 URL 或任意 data URL。自带三段示例音频合计约 391 KiB。
