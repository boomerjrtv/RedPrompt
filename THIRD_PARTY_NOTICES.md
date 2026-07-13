# Third-Party Notices

The MIT License in [`LICENSE`](LICENSE) applies only to RedPrompt's original
code and content. The following third-party components and assets remain under
their own licenses.

## Runtime software

### Express

- Package: `express` 4.22.2
- Source: <https://github.com/expressjs/express>
- License: MIT

Express and its transitive npm dependencies are installed from the package
registry and are not committed to this repository. Their declared licenses are
recorded in `package-lock.json`, and their license texts are included in their
respective installed packages.

### WebLLM

- Package: `@mlc-ai/web-llm` 0.2.84
- Source: <https://github.com/mlc-ai/web-llm>
- License: Apache License 2.0

WebLLM is loaded from jsDelivr at runtime and is not bundled in this
repository. Its version is pinned in `public/llm.js`. A copy of the Apache
License 2.0 is provided in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).

## Fonts

The following font files are distributed with RedPrompt under the SIL Open
Font License 1.1:

### Space Grotesk

- Files: `public/fonts/500-normal.woff2`, `public/fonts/700-normal.woff2`
- Copyright 2020 The Space Grotesk Project Authors
- Source: <https://github.com/floriankarsten/space-grotesk>
- License: SIL Open Font License 1.1

### JetBrains Mono

- Files: `public/fonts/jbm-400-normal.woff2`,
  `public/fonts/jbm-500-normal.woff2`, `public/fonts/jbm-700-normal.woff2`
- Copyright 2020 The JetBrains Mono Project Authors
- Source: <https://github.com/JetBrains/JetBrainsMono>
- License: SIL Open Font License 1.1

Copies of the font licenses are provided in
[`LICENSES/Space-Grotesk-OFL-1.1.txt`](LICENSES/Space-Grotesk-OFL-1.1.txt) and
[`LICENSES/JetBrains-Mono-OFL-1.1.txt`](LICENSES/JetBrains-Mono-OFL-1.1.txt).

## AI models

Model weights are not stored in or distributed with this repository. WebLLM
downloads the selected model artifacts directly to the user's browser at
runtime. Those artifacts are not covered by RedPrompt's MIT License and remain
subject to the model providers' terms:

- Llama 3.2 1B Instruct MLC artifacts:
  <https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC>
- Meta Llama 3.2 license and acceptable-use terms:
  <https://www.llama.com/llama3_2/license/>
- Qwen 3.5 0.8B MLC artifacts:
  <https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC>

Users and redistributors are responsible for reviewing and complying with the
applicable upstream model terms.
