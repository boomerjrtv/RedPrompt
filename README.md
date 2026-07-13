# RedPrompt — Browser-Native AI Red Team Lab

**Learn prompt injection & AI red teaming by doing.**
19 levels/case studies · 20 attack techniques — all running **100% in your browser** via WebGPU.

No API keys. No server-side LLM. No tracking. Host it as a static site anywhere.

## 🚀 Quick start

```bash
cd redprompt
node server.js          # → http://localhost:3000
```

That's it. On first load, RedPrompt asks before downloading Qwen 3.5 0.8B (~0.6 GB). The download is cached by the browser after first use.

## ✨ Features

- **19 progressive levels and case studies** — 13 core prompt-injection levels plus 6 production-inspired scenarios
- **Known starter phrasings** — every level includes solution-oriented starter prompts
- **📚 Technique library** — 20 prompt-injection techniques with examples and defenses
- **🎓 Curriculum** — OWASP LLM Top 10, the Prompt Injection 2.0 taxonomy, realistic defensive case studies, defense architecture
- **Live attack detection** — see which technique family your prompt triggers as you type
- **Progress saved** locally in your browser

## 🏗️ Architecture

```
redprompt/
├── server.js              # tiny static file server (or skip it for hosting)
├── package.json
├── public/                # ★ this is the entire deployable bundle ★
│   ├── index.html
│   ├── llm.js             # WebLLM (in-browser LLM via WebGPU)
│   ├── app.js             # app logic
│   ├── styles.css
│   └── data/
│       ├── levels.json
│       └── techniques.json
```

The browser loads WebLLM from a CDN at runtime, downloads the model weights into the browser cache, and then runs **everything** client-side. Your static host serves files and does nothing else.

## 🌐 Deploy

Deploy `public/` to any static host:

- **Netlify**: drag the `public/` folder onto app.netlify.com/drop
- **Vercel**: `vercel --prod` (it'll auto-detect static)
- **GitHub Pages**: push the repo, serve from `/public` or set up GitHub Actions
- **Cloudflare Pages**: connect the repo, build command empty, output dir `public`
- **Your own server**: `nginx` / `caddy` / `python -m http.server` / `node server.js`

For LinkedIn / portfolio sharing: deploy to Netlify or GitHub Pages, post the URL.

## 🤖 Model

RedPrompt uses one local browser model:

| Model | Size | Supported levels | Notes |
|---|---:|---:|---|
| Qwen 3.5 0.8B Instruct | ~0.6 GB | 1–19 | Full-lab model |

The smallest WebLLM-ready model that runs the full lab.

## 🛡️ Requirements

- A **WebGPU-capable browser** (Chrome 113+, Edge 113+, Firefox 141+, or recent Safari Tech Preview) on a desktop with a real GPU
- ~0.6 GB free disk for the local model cache
- A modern OS (macOS, Windows, or Linux with up-to-date GPU drivers)

The tool detects WebGPU on load and shows a clear error if unavailable.

## 🧠 What you'll learn

Mapped to the Prompt Injection 2.0 taxonomy:

- **Delivery vector**: direct injection, indirect (via processed content)
- **Attack modality**: text, encoded (base64/ROT13/leetspeak), hybrid (XSS+PI, P2SQL)
- **Propagation**: one-shot extraction vs. multi-turn progressive leaking
- **Defense layers**: system-prompt hardening, output filtering, delimiter isolation, access control, structural encoding

Plus the practical side: iterative prompting, model-specific behavior, and known starter payloads.

## 📜 License

RedPrompt's original code is licensed under the [MIT License](LICENSE).

Third-party software, fonts, and model assets remain under their respective
licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.
