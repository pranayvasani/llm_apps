# Scan to fill: bundled third-party files

These files run entirely in the browser. Tijori loads them from this folder only, and the page's
security policy limits network requests to this folder.

| File | What it is | Source | License |
|---|---|---|---|
| `ort.wasm.min.js`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm` | ONNX Runtime Web 1.31.1 (WebAssembly backend) | npm `onnxruntime-web@1.31.1` (Microsoft) | MIT |
| `det.ort` | PP-OCRv5 mobile text detection model | PaddleOCR (Baidu), redistributed in npm `pdfmarkdown-ppocrv5-models@1.0.0` | Apache-2.0 (see `LICENSE-models.txt`) |
| `rec.onnx`, `dict.txt` | PP-OCRv5 mobile text recognition model + character dictionary | same as above | Apache-2.0 |
| `pdf.min.mjs`, `pdf.worker.min.mjs` | PDF.js 6.5.438: reads digital PDFs' text and renders scanned pages | npm `pdfjs-dist@6.5.438` (Mozilla) | Apache-2.0 (see `LICENSE-pdfjs.txt`) |
| `pdfjs-wasm/*.wasm` | PDF.js image decoders for scanned PDFs (JBIG2, JPEG 2000, colour profiles) | same as above | see `pdfjs-wasm/LICENSE_*` |
| `paddle-ocr.js` | Tijori's own detection/recognition pipeline | this repo | same as Tijori |
| `pdf-read.js` | Tijori's PDF glue: text layer → lines, password prompt, page rendering | this repo | same as Tijori |
| `extract.js` | Tijori's rules that turn recognised text into form fields | this repo | same as Tijori |

`SHA256SUMS` records the checksum of each third-party file as committed.

PDF.js runs with scripting and eval turned off, so scripts embedded in a PDF never run. Its JavaScript engine for PDF forms (QuickJS) is not bundled.

Model files are data, not code: they're run by ONNX Runtime and can only affect recognised text.
Note: the character dictionary as published has a stray blank line, which `paddle-ocr.js` skips so
that characters line up with the model's output classes.

ONNX Runtime is Copyright (c) Microsoft Corporation, MIT License.
