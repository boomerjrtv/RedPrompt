// =====================================================================
// RedPrompt LLM — WebLLM (in-browser, WebGPU) only.
//
// Runs entirely client-side. No API keys and no server LLM/API backend.
// The whole app deploys as a static site. WebLLM/model assets are downloaded
// by the browser once and cached locally.
//
// Exposes `window.RP_LLM` for the rest of the frontend.
// =====================================================================

import * as webllm from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm";

const listeners = new Set();
function emit(ev) { for (const fn of listeners) { try { fn(ev); } catch {} } }

// Prebuilt WebLLM model IDs. Each entry is a self-contained bundle
// (weights + tokenizer + runtime) hosted on the WebLLM CDN.
export const MODELS = [
  { id: "Qwen3.5-0.8B-q4f16_1-MLC", label: "Local Model", size: "~0.6 GB", maxLevel: 19, blurb: "Original RedPrompt model. Best for prompt injection challenges.", recommended: true },
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "Fast Model", size: "~130 MB", maxLevel: 19, blurb: "Smaller, faster download. Works on more devices.", recommended: false }
];

const state = {
  modelId: MODELS.find(m => m.recommended)?.id || MODELS[0].id,
  webgpuOk: !!(navigator.gpu),
  engine: null,
  status: "idle",                    // 'idle' | 'loading' | 'ready' | 'error'
  progress: { text: "", progress: 0 },
  error: null
};

export function getState()  { return { ...state }; }
export function getModels() { return MODELS; }
export function onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---- WebGPU capability check ---------------------------------------------
// Returns { ok, reason, warnings[] }. ok=false means the lab cannot run;
// warnings[] are soft caveats (mobile, low memory) the UI can surface.
export async function checkWebGPU() {
  const warnings = [];

  // 1. Mobile / tablet: WebGPU on mobile Chrome and Safari 18+ is possible,
  //    but desktop/laptop browsers remain the most reliable target.
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || '');
  if (uaMobile) {
    warnings.push("You appear to be on a phone or tablet. Newer devices may work, but a desktop or laptop browser is the most reliable way to run the lab.");
  }

  // 2. navigator.gpu missing entirely.
  if (!navigator.gpu) {
    return { ok: false, reason: "WebGPU is not supported in this browser. Use Chrome 113+, Edge 113+, Brave 1.52+, Firefox 141+, or Safari 18+ on a desktop with a real GPU.", warnings };
  }

  // 3. Low memory heuristic (Chrome exposes navigator.deviceMemory).
  const dm = navigator.deviceMemory;
  if (typeof dm === 'number' && dm < 2) {
    warnings.push(`Your browser reports ~${dm} GB of device memory. If loading fails, try a desktop/laptop browser.`);
  }

  // 4. Request an adapter; some browsers expose navigator.gpu but return null,
  //    and some hang on requestAdapter() with no timeout. Race against a
  //    timeout so the boot never freezes on "Checking WebGPU…".
  try {
    const adapterPromise = navigator.gpu.requestAdapter();
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
    const a = await Promise.race([adapterPromise, timeout]);
    if (!a) {
      return { ok: false, reason: "No WebGPU adapter found. This usually means no compatible GPU is exposed to the browser, or hardware acceleration is disabled in your browser settings. Enable hardware acceleration and reload.", warnings };
    }
    return { ok: true, info: a.info || {}, warnings };
  } catch (e) {
    const isTimeout = (e.message === 'timeout');
    return { ok: false, reason: isTimeout
      ? "WebGPU adapter check timed out — the browser took too long to respond. Try reloading, or enable hardware acceleration in your browser settings."
      : "WebGPU init failed: " + (e.message || e) + " — try enabling hardware acceleration in your browser settings.", warnings };
  }
}

// ---- Model loading --------------------------------------------------------
export async function setModel(modelId, onProgress) {
  if (state.engine && state.modelId === modelId && state.status === "ready") return;
  state.modelId = modelId;
  emit({ type: "model", modelId });
  if (state.engine) {
    try { await state.engine.unload?.(); } catch {}
    state.engine = null;
  }
  await loadModel(modelId, onProgress);
}

async function loadModel(modelId, onProgress) {
  state.status = "loading";
  state.progress = { text: "Initialising WebGPU…", progress: 0 };
  state.error = null;
  emit({ type: "status", status: "loading", progress: state.progress });
  try {
    state.engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (rep) => {
        state.progress = rep;
        emit({ type: "status", status: "loading", progress: rep });
        if (onProgress) onProgress(rep);
      }
    });
    state.status = "ready";
    emit({ type: "status", status: "ready" });
  } catch (e) {
    state.status = "error";
    state.error = `Load failed for ${modelId}: ${e.message || e}`;
    emit({ type: "status", status: "error", error: state.error });
    throw new Error(state.error);
  }
}

// ---- Chat -----------------------------------------------------------------
// messages: OpenAI-style [{role, content}, ...]
function withOptionalSystemPrompt(messages, opts = {}) {
  if (!opts.systemPrompt) return messages;
  const hasSystem = messages[0]?.role === 'system';
  return hasSystem ? messages : [{ role: 'system', content: opts.systemPrompt }, ...messages];
}

export async function chat(messages, opts = {}) {
  if (!state.engine) throw new Error("Model not loaded. Click 'Load model' first.");
  // Some local browser models may emit reasoning-like text. Keep generation
  // short and low-penalty so responses stay concise and playable.
  // coherence and produces gibberish over long generations. Cap tokens so
  // reasoning can't spiral, and nudge it to be concise.
  const params = {
    messages: withOptionalSystemPrompt(messages, opts),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 96,
    frequency_penalty: opts.frequencyPenalty ?? 0,
    presence_penalty: opts.presencePenalty ?? 0,
    enable_thinking: false
  };
  const r = await state.engine.chat.completions.create(params);
  return r.choices[0].message.content;
}

// Streaming version — calls onChunk(delta) as tokens arrive.
// Returns the full response text on completion.
export async function chatStream(messages, opts = {}, onChunk) {
  if (!state.engine) throw new Error("Model not loaded. Click 'Load model' first.");
  const params = {
    messages: withOptionalSystemPrompt(messages, opts),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 96,
    frequency_penalty: opts.frequencyPenalty ?? 0,
    presence_penalty: opts.presencePenalty ?? 0,
    enable_thinking: false,
    stream: true,
    stream_options: { include_usage: true }
  };
  const asyncChunks = await state.engine.chat.completions.create(params);
  let full = '';
  for await (const chunk of asyncChunks) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (delta) {
      full += delta;
      onChunk(delta, full);
    }
  }
  return full;
}

// Reset internal conversation state — used by the dev test suite so each
// payload runs from a clean slate instead of inheriting prior turns.
export function resetChat() {
  if (!state.engine) return;
  try { state.engine.resetChat?.(); } catch {}
}

// Expose to the rest of the (non-module) app.
window.RP_LLM = { MODELS, getState, getModels, onEvent, checkWebGPU, setModel, resetChat, chat, chatStream };
emit({ type: "ready" });
