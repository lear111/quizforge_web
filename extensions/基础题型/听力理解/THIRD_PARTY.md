# MP3 encoder

The authoring page includes the unmodified browser distribution of
`@breezystack/lamejs` 1.2.7, licensed under LGPL-3.0. The license is included in
`LICENSE.lamejs.txt`. The encoder is bundled only in `editor.js`; practice pages
do not load it.

Upstream source: https://github.com/shijinyu/lamejs

Published package and corresponding source:
https://www.npmjs.com/package/@breezystack/lamejs/v/1.2.7

To replace or rebuild the encoder, install the desired compatible version in
`core/`, then run `node core/scripts/build/build-listening.mjs`. The build reads
`core/node_modules/@breezystack/lamejs/dist/lamejs.iife.js` without modifying it.
