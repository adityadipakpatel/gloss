# lib

- `markdown.js`, `prompt.js`, `api.js`, `store.js`: Gloss's own modules.
- `pdf.min.mjs`, `pdf.worker.min.mjs`: [pdf.js](https://mozilla.github.io/pdf.js/) 6.3.289,
  copied unmodified from the `legacy/build/` folder of the `pdfjs-dist` npm package
  (Apache-2.0, see `pdfjs-LICENSE`). Manifest V3 forbids remotely hosted code, so the
  library is vendored here. The legacy build is used because it runs on older Chrome
  versions as well as current ones.

To update pdf.js: `npm pack pdfjs-dist`, unpack it, and copy the two files from
`package/legacy/build/` over the ones here.
