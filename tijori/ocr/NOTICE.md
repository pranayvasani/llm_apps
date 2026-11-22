# Scan to fill: bundled third-party files

These files run entirely in the browser. Tijori loads them from this folder only, and the page's
security policy limits network requests to this folder.

| File | What it is | Source | License |
|---|---|---|---|
| `ort.wasm.min.js`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm` | ONNX Runtime Web 1.31.1 (WebAssembly backend) | npm `onnxruntime-web@1.31.1` (Microsoft) | MIT |
| `det.ort` | PP-OCRv5 mobile text detection model | PaddleOCR (Baidu), redistributed in npm `pdfmarkdown-ppocrv5-models@1.0.0` | Apache-2.0 (see `LICENSE-models.txt`) |
| `rec.onnx`, `dict.txt` | PP-OCRv5 mobile text recognition model + character dictionary | same as above | Apache-2.0 |
| `paddle-ocr.js` | Tijori's own detection/recognition pipeline | this repo | same as Tijori |
| `extract.js` | Tijori's rules that turn recognised text into form fields | this repo | same as Tijori |

`SHA256SUMS` records the checksum of each third-party file as committed.

Model files are data, not code: they're run by ONNX Runtime and can only affect recognised text.
Note: the character dictionary as published has a stray blank line, which `paddle-ocr.js` skips so
that characters line up with the model's output classes.

ONNX Runtime is Copyright (c) Microsoft Corporation, MIT License.
