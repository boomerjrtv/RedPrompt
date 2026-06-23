// =====================================================================
// RedPrompt frontend — fully client-side.
// All LLM calls go through window.RP_LLM (WebLLM, in-browser).
// All data is fetched from /data/*.json (static files).
// No server-side LLM. No external API.
// =====================================================================

let state = {
  view: 'home',
  levels: [],
  techniques: [],
  currentLevel: null,
  levelHistory: [],
  completedLevels: JSON.parse(localStorage.getItem('rp_completed') || '[]')
};

// ---- Data loading --------------------------------------------------------
const APP_VERSION = '20260627-progfix';
function versioned(path) { return `${path}?v=${APP_VERSION}`; }

async function loadData() {
  const [lv, tech] = await Promise.all([
    fetch(versioned('data/levels.json'), { cache: 'no-store' }).then(r => r.json()),
    fetch(versioned('data/techniques.json'), { cache: 'no-store' }).then(r => r.json())
  ]);
  state.levels = lv;
  state.techniques = tech;
}

// ---- Navigation ----------------------------------------------------------
function showView(v) {
  state.view = v;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('view-' + v);
  if (el) el.classList.add('active');
  const btn = document.querySelector(`.nav-btn[data-view="${v}"]`);
  if (btn) btn.classList.add('active');
  if (v === 'levels') renderLevels();
  if (v === 'techniques') renderTechniques();
}

// ---- Model boot + switching --------------------------------------------
function currentModelMeta() {
  const s = window.RP_LLM?.getState?.();
  return window.RP_LLM?.getModels?.().find(m => m.id === s?.modelId);
}

function setStatusBadge(status, modelLabel) {
  const dot = document.getElementById('model-status-dot');
  const label = document.getElementById('model-status-label');
  const m = modelLabel || currentModelMeta()?.label || 'model';
  if (dot) {
    dot.className = 'status-dot ' +
      (status === 'ready' ? 'status-ready' :
       status === 'loading' ? 'status-loading' :
       status === 'error' ? 'status-error' : 'status-idle');
  }
  if (label) {
    label.textContent =
      status === 'ready' ? `${m} ready` :
      status === 'loading' ? 'loading…' :
      status === 'error' ? 'error' : 'no model';
  }
}

let _boot = { target: 0, shown: 0, timer: null, stage: '' };

function setBootProgress(text, pct, detail) {
  const label = document.getElementById('boot-label');
  const det   = document.getElementById('boot-detail');
  if (label && text) label.textContent = text;
  if (det)   det.textContent  = detail || '';
  // pct is the WebLLM-reported target. We animate the bar continuously toward it
  // and keep nudging it forward during silent gaps, so it never looks frozen.
  if (typeof pct === 'number') _boot.target = Math.min(1, Math.max(_boot.target, pct));
  if (text) _boot.stage = text;
  startBootAnim();
}

function startBootAnim() {
  if (_boot.timer) return;
  const fill = document.getElementById('boot-fill');
  _boot.timer = setInterval(() => {
    const t = _boot.target;
    // ease the shown value toward the reported target (faster easing so the bar
    // visibly chases reports instead of lagging behind during bursty cache loads)
    if (_boot.shown < t) _boot.shown += (t - _boot.shown) * 0.4;
    // during silent gaps (WebLLM reports sparsely, esp. during GPU init after
    // download), creep forward slowly toward ~0.98 so the bar never looks frozen.
    // The final 2% is reserved for true 'Ready' so the bar can't lie about done.
    else if (_boot.shown < 0.98) _boot.shown += 0.0035;
    if (_boot.shown > 0.999) _boot.shown = 1;
    if (fill) fill.style.width = `${Math.round(_boot.shown * 100)}%`;
    // when we've crept high but no real progress, hint that GPU init is happening
    const label = document.getElementById('boot-label');
    if (label && _boot.shown >= 0.9 && _boot.target < 1 && /Loading|downloading/i.test(label.textContent || '')) {
      label.textContent = 'Initializing GPU memory…';
    }
    // stop the timer once we've fully settled at 100%
    if (_boot.shown >= 1 && _boot.target >= 1) { clearInterval(_boot.timer); _boot.timer = null; }
  }, 60);
}

function hideBoot() {
  const ov = document.getElementById('boot-overlay');
  if (!ov) return;
  ov.classList.add('hidden');
  setTimeout(() => { ov.style.display = 'none'; }, 700);
}

function showBootError(msg) {
  const e = document.getElementById('boot-error');
  if (e) { e.classList.remove('hidden'); e.textContent = msg; }
}
function clearBootError() {
  const e = document.getElementById('boot-error');
  if (e) { e.classList.add('hidden'); e.textContent = ''; }
}

function selectedModelMeta() {
  return window.RP_LLM.getModels()[0];
}

function updateModelHelp() {
  const m = selectedModelMeta();
  const help = document.getElementById('boot-model-help');
  const bootName = document.getElementById('boot-model-name');
  const navName = document.getElementById('nav-model-name');
  if (bootName) bootName.textContent = `${m.label} · ${m.size}`;
  if (navName) navName.textContent = `${m.label} · ${m.size}`;
  if (help) help.textContent = `${m.label} (${m.size}) powers the full RedPrompt lab. It supports Levels 1–${m.maxLevel}. ${m.blurb}`;
  if (state.view === 'levels') renderLevels();
}

function renderModelPickers() { updateModelHelp(); }
function syncModelPickers() { updateModelHelp(); }

function setModelButtons(disabled) {
  for (const id of ['boot-load-btn', 'nav-model-load']) {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  }
}

async function bootModel() {
  renderModelPickers();
  setStatusBadge('idle');
  // Do NOT auto-check WebGPU or auto-load on page load — both were surprising.
  // Just show the panel and wait for the user to click "Load model". The click
  // handler runs the (timeout-protected) WebGPU check and then loads.
  const rec = selectedModelMeta();
  setBootProgress('Ready when you are', 0, `${rec.label} (${rec.size}) · click “Load model” to start.`);
}

function showBootWarnings(warnings) {
  const box = document.getElementById('boot-warnings');
  if (!box) return;
  if (!warnings || warnings.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = warnings.map(w => `<p>${escapeHTML(w)}</p>`).join('');
}

async function loadSelectedModel(source = 'boot') {
  const model = selectedModelMeta();
  syncModelPickers();
  clearBootError();
  setModelButtons(true);
  setStatusBadge('loading', model.label);

  // Check WebGPU on click (timeout-protected). Runs here so the boot panel
  // never auto-freezes on page load — the user explicitly asked to load.
  setBootProgress('Checking WebGPU…', 0.02, '');
  const wg = await window.RP_LLM.checkWebGPU();
  if (!wg.ok) {
    setStatusBadge('error');
    setBootProgress('WebGPU not available', 0, '');
    setModelButtons(false);
    showBootError((wg.reason || 'WebGPU missing.') + '\n\nRedPrompt needs WebGPU. Use Chrome 113+, Edge 113+, Brave 1.52+, Firefox 141+, or Safari 18+ on a desktop with a real GPU, with hardware acceleration enabled.');
    showBootWarnings(wg.warnings || []);
    return;
  }
  showBootWarnings(wg.warnings || []);

  setBootProgress(`Loading ${model.label}…`, 0.03, `Downloading ${model.size}. Cached after first run.`);

  try {
    await window.RP_LLM.setModel(model.id, (rep) => {
      const pct = rep.progress ?? 0;
      setBootProgress(rep.text || 'Loading…', pct, `${model.label} · ${Math.round(pct * 100)}%`);
    });
    setStatusBadge('ready', model.label);
    setBootProgress('Ready', 1, `${model.label} loaded into your browser`);
    localStorage.setItem('rp_model_cached', 'true');
    setTimeout(hideBoot, 500);
  } catch (err) {
    setStatusBadge('error', model.label);
    setBootProgress('Failed to load model', 0, '');
    showBootError((err && err.message) || String(err));
  } finally {
    setModelButtons(false);
  }
}

window.RP_LLM?.onEvent((ev) => {
  if (ev.type === 'status') setStatusBadge(ev.status);
  if (ev.type === 'model') { syncModelPickers(); updateModelHelp(); }
});

// ---- Levels --------------------------------------------------------------
function renderLevels() {
  const grid = document.getElementById('level-grid');
  if (!grid) return;
  const filter = state.currentFilter || 'all';
  const list = filter === 'all' ? state.levels : state.levels.filter(l => l.difficulty === filter);
  grid.innerHTML = list.map(l => {
    const done = state.completedLevels.includes(l.id);
    const id = Number(l.id);
    const tag = String(l.id).padStart(2, '0');
    return `
      <div class="level-card ${done ? 'completed' : ''}" onclick="startLevel(${id})">
        <div class="lc-top">
          <span class="lvl-tag">LVL ${escapeHTML(tag)}</span>
          <span class="diff-pill diff-${cssClass(l.difficulty)}">${escapeHTML(l.difficulty)}</span>
        </div>
        <span class="lc-cat">${escapeHTML(l.category)}</span>
        <h3>${escapeHTML(l.name)}</h3>
        <p>${escapeHTML(l.description)}</p>
        <div class="lc-foot">
          <span class="lc-status ${done ? 'lc-cracked' : 'lc-attempt'}">
            <svg class="ico"><use href="#${done ? 'i-check-circle' : 'i-lock'}"/></svg>
            ${done ? 'CRACKED' : 'ATTEMPT'}
          </span>
        </div>
      </div>`;
  }).join('') || '<p class="view-desc" style="max-width:var(--max);margin:10px auto">No levels at this difficulty.</p>';
  updateProgressCount();
}

function updateProgressCount() {
  const el = document.getElementById('levels-progress-count');
  if (el) el.textContent = state.completedLevels.length;
}

function filterLevels(diff) {
  state.currentFilter = diff;
  document.querySelectorAll('#level-filters .filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === diff);
  });
  renderLevels();
}

function startLevel(id) {
  const lv = state.levels.find(x => x.id === id);
  if (!lv) return;
  state.currentLevel = lv;
  state.levelHistory = [];
  document.getElementById('game-level-badge').textContent = `LVL ${String(lv.id).padStart(2,'0')}`;
  document.getElementById('game-level-name').textContent = lv.name;
  const diffEl = document.getElementById('game-level-diff');
  if (diffEl) { diffEl.textContent = lv.difficulty; diffEl.className = `diff-pill diff-${cssClass(lv.difficulty)}`; }
  document.getElementById('game-level-cat').textContent = lv.category;
  document.getElementById('attempt-count').textContent = '0';
  const mechLabel = {
    input_filter: 'INPUT FILTER ACTIVE — prohibited terms in your message are blocked before the model sees them.',
    guardian: 'GUARDIAN MONITOR ACTIVE — a second model screens every message for attacks before the target responds.',
    indirect: 'INDIRECT CHANNEL — your input is processed as DATA (not instructions). The target will act on the data block.'
  }[lv.mechanism];
  const mechHtml = mechLabel ? `<p class="msg-hint msg-mech">DEFENSE &nbsp;${escapeHTML(mechLabel)}</p>` : '';
  document.getElementById('chat-messages').innerHTML = `
    <div class="message">
      <div class="msg-avatar ai">AI</div>
      <div class="msg-content">
        <p><strong>${escapeHTML(lv.name)}</strong> — ${escapeHTML(lv.description)}</p>
        <p class="msg-hint">HINT &nbsp;${escapeHTML(lv.hint)}</p>
        ${mechHtml}
        <p class="msg-hint">GOAL &nbsp;Make the target output its secret marker. The system auto-detects it in every response — including reasoning.</p>
        <p class="msg-hint">NOTE &nbsp;Local models are probabilistic. If it refuses or loops, rephrase or switch vector.</p>
      </div>
    </div>`;
  document.getElementById('chat-input').value = '';
  document.getElementById('attack-detector').innerHTML = '';
  showView('game');
  document.getElementById('chat-input').focus();
  populateLevelJump();
}

function populateLevelJump() {
  const sel = document.getElementById('level-jump');
  if (!sel) return;
  sel.innerHTML = '<option value="">Jump…</option>' +
    state.levels.map(l => `<option value="${escapeAttr(l.id)}">LVL ${String(l.id).padStart(2,'0')} · ${escapeHTML(l.name)}</option>`).join('');
}
function jumpToLevel(id) {
  const sel = document.getElementById('level-jump');
  if (sel) sel.value = '';
  if (id) startLevel(parseInt(id));
}

// ---- Defense mechanisms (model-independent difficulty) --------------------
// These make levels genuinely hard regardless of model size, by putting the
// defense in CODE rather than begging a small model to comply.
//   - input_filter : JS blocks banned terms in user input before the model sees them.
//                    Teaches payload obfuscation (base64/rot13/homoglyphs).
//   - guardian     : a REAL second model pass screens the message for attacks.
//                    Teaches evaluator/monitor bypass.
//   - indirect     : the user's input is inserted into a DATA slot (an email / doc
//                    / form) the model processes — not as an instruction. Teaches
//                    indirect prompt injection (how real breaches happen).

function escapeRegExpLocal(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

// Insert the user's message into the level's data slot (indirect injection).
// The system prompt contains {{USER_DATA}}; we substitute the raw user input so
// it arrives as untrusted data the model must process, not as an instruction.
function buildSystemPrompt(level, userInput) {
  let sys = level.systemPrompt || '';
  if (level.mechanism === 'indirect' && sys.includes('{{USER_DATA}}')) {
    sys = sys.replace('{{USER_DATA}}', userInput || '(empty)');
  }
  return sys;
}

// INPUT FILTER: returns { pass, blockedTerm } — synchronous, runs before any model call.
function runInputFilter(level, msg) {
  const f = level.inputFilter;
  if (!f || !f.enabled) return { pass: true };
  const terms = f.terms || [];
  for (const t of terms) {
    let re;
    try {
      re = typeof t === 'string'
        ? new RegExp(escapeRegExpLocal(t), 'i')
        : new RegExp(t.source, t.flags || 'i');
    } catch { continue; }
    if (re.test(msg)) {
      return { pass: false, blockedTerm: typeof t === 'string' ? t : t.source };
    }
  }
  return { pass: true };
}

// GUARDIAN: a real second inference pass, run as an ensemble (2 votes, fail-closed).
// A 0.8B monitor is noisy, so we require BOTH votes to explicitly say SAFE;
// anything else (ATTACK, garbage, error) counts as a block. This is the
// conservative reading a real security monitor should take.
async function runGuardian(level, msg) {
  const g = level.guardian;
  if (!g || !g.enabled) return { allow: true };
  // Single-vote guardian. (Tried a 2-vote ensemble, but it over-blocked benign
  // traffic — a 0.8B monitor is noisy, and requiring agreement made Hard levels
  // unsolvable. Single vote + strict prompt is the right balance.)
  const votes = [];
  window.RP_LLM.resetChat?.();
  try {
    const reply = await window.RP_LLM.chat(
      [{ role: 'system', content: g.systemPrompt }, { role: 'user', content: msg }],
      { temperature: 0.3, maxTokens: 30 }
    );
    // Robust classifier: the 0.8B rambles instead of emitting one word, so we
    // scan the whole reply. SAFE only if it contains 'safe' AND no attack-words.
    const t = (reply || '').toUpperCase();
    const hasSafe = /\bSAFE\b/.test(t);
    const hasAttack = /\b(ATTACK|BLOCK|INJECT|REFUS|UNSAFE|MALICIOUS|DENIED|FLAG)\b/.test(t);
    const isSafe = hasSafe && !hasAttack;
    votes.push(isSafe ? 'SAFE' : 'ATTACK');
  } catch (e) {
    votes.push('ATTACK'); // monitor error -> block
  }
  window.RP_LLM.resetChat?.();
  const allow = votes.every(v => v === 'SAFE');
  return {
    allow,
    verdict: votes.join('+'),
    reason: allow ? '' : (g.blockMessage || 'Guardian flagged this message as an attack.')
  };
}

function addSystemBanner(text, kind) {
  // kind: 'blocked' | 'guardian' | 'system'
  const c = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `message sys-banner sys-${kind || 'system'}`;
  const icon = kind === 'blocked' ? '#i-shield' : kind === 'guardian' ? '#i-shield' : '#i-info';
  div.innerHTML = `<div class="msg-avatar ai">--</div><div class="msg-content"><p class="banner-text">${escapeHTML(text)}</p></div>`;
  c.appendChild(div);
  document.getElementById('chat-container').scrollTop = document.getElementById('chat-container').scrollHeight;
}

async function sendMessage() {
  if (!state.currentLevel) return;
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  addChatMessage(msg, 'user');
  input.value = '';
  document.getElementById('attack-detector').innerHTML = '';
  const sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = true; setSendState(true);

  // --- DEFENSE GATE 1: input filter (synchronous, before model) ---
  const filt = runInputFilter(state.currentLevel, msg);
  if (!filt.pass) {
    addSystemBanner(`INPUT BLOCKED by input filter — prohibited term detected: "${filt.blockedTerm}". The model never saw your message. Obfuscate the payload to slip past the filter.`, 'blocked');
    setSendState(false); sendBtn.disabled = false;
    return;
  }

  // For indirect levels, the user input becomes DATA, not an instruction —
  // it doesn't go into the chat history as a normal user turn; it's injected
  // into the system prompt's data slot. The model's job is to "process" it.
  const isIndirect = state.currentLevel.mechanism === 'indirect';
  if (!isIndirect) state.levelHistory.push({ role: 'user', content: msg });
  const attacks = detectAttacks(msg);
  if (attacks.length) addAttackBadges(attacks);

  // --- DEFENSE GATE 2: guardian (real second model pass) ---
  const guard = await runGuardian(state.currentLevel, msg);
  if (!guard.allow) {
    addSystemBanner(`GUARDIAN BLOCKED the request. ${guard.reason} (monitor verdict: ${escapeHTML((guard.verdict||'').slice(0,40))}) The target model was never invoked. Craft input that passes the monitor.`, 'guardian');
    setSendState(false); sendBtn.disabled = false;
    return;
  }

  try {
    const sys = buildSystemPrompt(state.currentLevel, msg);
    // Indirect levels process each submission as an independent data item
    // (like a real email-triage or doc-tagging bot). Reset the engine first so
    // prior refusals don't prime/anchor the model — matches the validated behavior.
    if (isIndirect) window.RP_LLM.resetChat?.();
    const messages = isIndirect
      ? [{ role: 'system', content: sys }, { role: 'user', content: 'Process the data above.' }]
      : [{ role: 'system', content: sys }, ...state.levelHistory];
    const reply = await (async () => {
      // Create placeholder for streaming
      const c = document.getElementById('chat-messages');
      const div = document.createElement('div');
      div.className = 'message';
      div.innerHTML = '<div class="msg-avatar ai">AI</div><div class="msg-content"><p></p></div>';
      c.appendChild(div);
      const p = div.querySelector('p');
      const scroll = () => { document.getElementById('chat-container').scrollTop = document.getElementById('chat-container').scrollHeight; };
      const full = await window.RP_LLM.chatStream(messages, { temperature: 0.7, maxTokens: 512 }, (delta, _full) => {
        p.innerHTML = formatText(_full);
        scroll();
      });
      div.remove();
      return full;
    })();
    if (!isIndirect) state.levelHistory.push({ role: 'assistant', content: reply });

    const attempts = (parseInt(document.getElementById('attempt-count').textContent, 10) || 0) + 1;
    document.getElementById('attempt-count').textContent = attempts;

    // Reasoning models leak secrets inside <think> too — detect on the FULL output.
    const revealed = checkSecretRevealed(reply, state.currentLevel.secret, state.currentLevel.defenseType, msg);
    const { think, answer } = splitThink(reply);
    let displayText, displayThink;
    if (answer) {
      displayText = answer;
      displayThink = think;
    } else if (think) {
      displayText = think;
      displayThink = null;
    } else {
      displayText = reply;
      displayThink = null;
    }

    if (revealed) {
      addChatMessage(displayText, 'assistant reveal-msg', revealed && displayThink ? displayThink : null);
      onLevelComplete();
    } else {
      addChatMessage(displayText, 'assistant', displayThink);
      if (attempts === 5) setTimeout(showStuckHint, 400);
    }
  } catch (e) {
    addChatMessage('error — ' + (e.message || e), 'system');
  }
  sendBtn.disabled = false; setSendState(false);
}
function addAttackBadges(names) {
  document.getElementById('attack-detector').innerHTML = names.map(n => `<span class="attack-tag"><svg class="ico"><use href="#i-alert"/></svg> ${escapeHTML(n)}</span>`).join('');
}

function splitThink(raw) {
  // Reasoning models (Qwen 3.5) emit <think>...</think>. Split it out so we can
  // hide the raw chain-of-thought from the chat UI while still scanning it for leaks.
  const full = raw || '';
  const closed = full.match(/<think>([\s\S]*?)<\/think>/i);
  if (closed) {
    return {
      think: closed[1].trim(),
      answer: full.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(),
      full
    };
  }
  // Unclosed <think> (model was truncated mid-reasoning).
  const openIdx = full.search(/<think>/i);
  if (openIdx !== -1) {
    return { think: full.slice(openIdx + 7).trim(), answer: '', full };
  }
  // Qwen 3.5 0.8B often rambles without <think> tags.
  // Detect self-correction loops and repeated phrases; extract last non-ramble sentence.
  const rambleMarkers = /(?:^|\n)(Actually|Wait,? actually|I think|Let me|Hmm,?|OK,? let me|I need to|I should|But actually|No,? that|No wait|Okay,? I can|I cannot|I am not sure)\b/gmi;
  const markerCount = (full.match(rambleMarkers) || []).length;
  const sentences = full.split(/(?<=[.!?])\s+/);
  const phraseCounts = {};
  for (const s of sentences) {
    const clean = s.trim();
    if (clean.length > 15) phraseCounts[clean] = (phraseCounts[clean] || 0) + 1;
  }
  const maxRepeat = Math.max(0, ...Object.values(phraseCounts));
  if ((markerCount >= 3 || maxRepeat >= 4) && full.length > 200) {
    for (let i = sentences.length - 1; i >= 0; i--) {
      const s = sentences[i].trim();
      if (!s.match(/^(Actually|Wait|I think|Hmm|Let me|OK|But|No|I need|I should|Surely|So I|Okay|I can|I cannot|I am)\b/i) && s.length > 10) {
        return { think: full.trim(), answer: s, full };
      }
    }
    const last = sentences[sentences.length - 1].trim();
    if (last) return { think: full.trim(), answer: last, full };
  }
  return { think: '', answer: full.trim(), full };
}

function addChatMessage(text, type, think) {
  const c = document.getElementById('chat-messages');
  const isUser = type.includes('user');
  const isReveal = type.includes('reveal-msg');
  const div = document.createElement('div');
  div.className = `message ${isUser ? 'user-msg' : ''}`;
  const hasThink = !isUser && think && String(think).trim().length > 0;
  const thinkBlock = hasThink
    ? `<details class="msg-think"><summary><svg class="ico chev"><use href="#i-chevron-right"/></svg> model reasoning</summary><div class="msg-think-body">${formatText(think)}</div></details>`
    : '';
  div.innerHTML = `
    <div class="msg-avatar ${isUser ? 'usr' : 'ai'}">${isUser ? 'YOU' : 'AI'}</div>
    <div class="msg-content ${isReveal ? 'msg-reveal' : ''}">
      <p>${formatText(text)}</p>
      ${thinkBlock}
      ${isReveal ? '<div class="reveal-banner"><svg class=\"ico\"><use href=\"#i-check-circle\"/></svg> SECRET CRACKED</div>' : ''}
    </div>`;
  c.appendChild(div);
  document.getElementById('chat-container').scrollTop = document.getElementById('chat-container').scrollHeight;
}

function escapeHTML(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s = '') { return escapeHTML(s); }
function cssClass(s = '') { return String(s).replace(/[^a-zA-Z0-9_-]/g, '-'); }

function formatText(t) {
  return escapeHTML(t).replace(/\n/g, '<br/>');
}
function detectAttacks(message) {
  const lower = message.toLowerCase();
  const out = [];
  if (/\b(password|secret|key|code)\b/i.test(message) && /\b(what|tell|show|give|reveal)\b/i.test(message)) out.push('Direct Injection');
  if (/ignore\s+(all\s+)?(previous|prior|above|your)\s+(instructions|commands|directives)/i.test(lower)) out.push('Ignore Instructions');
  if (/(pretend|act\s+(as|like)|role.?play|you\s+are\s+now)/i.test(lower)) out.push('Role Play');
  if (/\b(base64|encode|decode|backwards|reverse)\b/i.test(message) && /(password|secret)/i.test(lower)) out.push('Encoding');
  if (/\b(DAN|do\s+anything\s+now|jailbreak)\b/i.test(lower)) out.push('Jailbreak');
  return out;
}
function setSendState(loading) {
  const sendBtn = document.getElementById('send-btn');
  if (!sendBtn) return;
  const icon = loading ? '#i-chevrons-right' : '#i-send';
  const label = loading ? 'Working' : 'Send';
  sendBtn.innerHTML = `<svg class="ico"><use href="${icon}"/></svg><span>${label}</span>`;
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function checkSecretRevealed(response, secret, defenseType, userInput) {
  const r = response;
  const u = r.toUpperCase();
  const s = secret.toUpperCase();
  if (!s || s.length < 2) return false;

  // The user's own input — encoded forms already present here must NOT count,
  // otherwise the detector fires on the user pasting back the base64 we gave them.
  const userU = (userInput || '').toUpperCase();
  const userHad = (frag) => frag.length >= 4 && userU.includes(frag);

  // 1. Exact substring (case-insensitive) — always counts; the user can't
  //    legitimately force a match here without already having the answer.
  if (u.includes(s)) return true;

  // 1b. Composite secret revealed as separate fields.
  // Example target marker: EMP-001234-SSN-123-45-6789.
  // The model may output "Employee ID: EMP-001234" and "SSN: 123-45-6789"
  // without ever printing the combined marker exactly.
  const chunks = s.split(/[-_\s/]+/).filter(part =>
    part.length >= 3 && !/^\d{1,2}$/.test(part)
  );
  if (chunks.length >= 3) {
    const hits = chunks.filter(part => u.includes(part));
    if (hits.length >= Math.min(chunks.length, 4)) return true;
  }

  // 2. Base64 encoding of the secret (only if the model produced it, not echoed)
  try {
    const b64 = btoa(secret).toUpperCase();
    if (u.includes(b64) && !userHad(b64)) return true;
    // Also try URL-safe variant
    const b64safe = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (u.includes(b64safe) && !userHad(b64safe)) return true;
  } catch {}

  // 3. Hex encoding of the secret
  const hex = Array.from(new TextEncoder().encode(secret))
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  if (u.includes(hex) && !userHad(hex)) return true;

  // 4. ROT13 of the secret
  const rot13 = secret.replace(/[a-zA-Z]/g, c =>
    String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13))
  );
  if (u.includes(rot13.toUpperCase()) && !userHad(rot13.toUpperCase())) return true;

  // 5. Reversed secret
  const back = s.split('').reverse().join('');
  if (u.includes(back) && !userHad(back)) return true;

  // 6. Spaced out (F L A M I N G O) with arbitrary non-alphanum between
  const spaced = s.split('').join('[^A-Z0-9]*');
  if (new RegExp(spaced, 'i').test(r)) return true;

  // 7. With dashes/underscores (F-L-A-M-I-N-G-O or f_l_a_m_i_n_g_o)
  const dashed = s.split('').join('[-_\\s]*');
  if (new RegExp(dashed, 'i').test(r)) return true;

  // 8. Pattern match: "the secret/password/code is X" or "it is X" or "X is the ..."
  //    For short secrets (< 6 chars), require word boundaries
  if (s.length >= 3) {
    const patterns = [
      new RegExp(`(?:secret|password|code|token|key|answer|word)\\s*(?:is|=|:)\\s*["']?${escapeRegExp(s)}["']?`, 'i'),
      new RegExp(`["']?${escapeRegExp(s)}["']?\\s*(?:is|=|:)\\s*(?:the|my|a|your)\\s+(?:secret|password|code|token|key|answer|word)`, 'i'),
      new RegExp(`(?:it|that)\\s+is\\s+["']?${escapeRegExp(s)}["']?`, 'i')
    ];
    for (const p of patterns) {
      if (p.test(r)) return true;
    }
  }

  // 9. Acrostic: if secret is "FLAMINGO" and response contains a multi-line block
  //    where the first letter of each line spells it
  const lines = r.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length >= s.length && s.length <= 12) {
    const acrostic = lines.slice(0, s.length).map(l => l[0] || '').join('').toUpperCase();
    if (acrostic === s) return true;
  }

  return false;
}

function onLevelComplete() {
  const lv = state.currentLevel;
  const completed = state.completedLevels;
  const list = state.levels;
  const key = 'rp_completed';

  if (!completed.includes(lv.id)) {
    completed.push(lv.id);
    localStorage.setItem(key, JSON.stringify(completed));
  }
  updateProgressCount();
  setTimeout(() => {
    const next = list.find(x => x.id === lv.id + 1);
    document.getElementById('modal-title').textContent = 'Secret extracted';
    document.getElementById('modal-body').innerHTML = `
      <p style="color:var(--text-dim);">Target <strong>${escapeHTML(lv.name)}</strong> compromised. The secret marker leaked in the response.</p>
      <div class="solution-box">
        <strong>Secret marker</strong>
        <code>${escapeHTML(lv.secret)}</code>
      </div>
      <p style="font-size:0.82rem;color:var(--text-mute);font-family:var(--f-mono);">category: ${escapeHTML(lv.category)} · defense: ${escapeHTML(lv.defenseType || 'none')}</p>
      <p style="text-align:center;margin-top:18px;">
        ${next
          ? `<button class="btn btn-primary" onclick="closeModal();startLevel(${Number(next.id)})"><span>Next target</span><svg class=\"ico\"><use href=\"#i-arrow-right\"/></svg></button>`
          : '<strong style="color:var(--green);">Lab complete.</strong>'}
      </p>
      <p style="text-align:center;color:var(--text-mute);font-family:var(--f-mono);font-size:0.76rem;margin-top:10px;">progress ${completed.length}/${list.length}</p>`;
    document.getElementById('modal-overlay').classList.remove('hidden');
  }, 400);
}

function backToLevels() { state.currentLevel = null; showView('levels'); }

function nextLevel() {
  const cur = state.currentLevel;
  if (!cur) return;
  const next = state.levels.find(x => x.id === cur.id + 1);
  if (next) startLevel(next.id);
  else showToast('Already at the final target.', 'info');
}

function showSkipModal() {
  if (!state.currentLevel) return;
  const lv = state.currentLevel;
  const starters = [...new Set([...(lv.starterPayloads || []), lv.starterPayload].filter(Boolean))];
  document.getElementById('modal-title').textContent = 'Skip this target';
  document.getElementById('modal-body').innerHTML = `
    <p style="color:var(--text-dim);">Reveal a working payload for <strong>${escapeHTML(lv.name)}</strong> and move on.</p>
    ${starters.length ? `<div class="solution-box"><strong>Working payload${starters.length > 1 ? 's' : ''}</strong>${starters.map((p, i) => `<code>${starters.length > 1 ? `${i+1}. ` : ''}${escapeHTML(p)}</code>`).join('')}</div>` : '<p>No payload recorded.</p>'}
    <p style="text-align:center;margin-top:16px;">
      <button class="btn btn-primary" onclick="closeModal();nextLevel()"><span>Next target</span><svg class=\"ico\"><use href=\"#i-arrow-right\"/></svg></button>
      <button class="btn btn-ghost" style="margin-left:8px;" onclick="closeModal()">Stay here</button>
    </p>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function showHint() {
  if (!state.currentLevel) return;
  const lv = state.currentLevel;
  document.getElementById('modal-title').textContent = 'Hint';
  const starters = [...new Set([...(lv.starterPayloads || []), lv.starterPayload].filter(Boolean))];
  const mechLabel = { input_filter:'INPUT FILTER', guardian:'GUARDIAN MONITOR', indirect:'INDIRECT (DATA CHANNEL)' }[lv.mechanism];
  const mechHtml = mechLabel ? `<span class="diff-pill diff-${cssClass(lv.difficulty)}" style="margin-right:8px">${escapeHTML(mechLabel)}</span>` : '';
  document.getElementById('modal-body').innerHTML = `<p>${mechHtml}<strong>Technique:</strong> ${escapeHTML(lv.technique || 'Direct extraction')}</p>
    <p>${escapeHTML(lv.hint)}</p>
    ${starters.length ? `<div class="solution-box"><strong>Known starter phrasing${starters.length > 1 ? 's' : ''}</strong>${starters.map((p, i) => `<code>${starters.length > 1 ? `${i+1}. ` : ''}${escapeHTML(p)}</code>`).join('')}</div>` : ''}
    <p style="color:var(--text-mute);margin-top:10px;font-size:0.84rem;">Model outputs are probabilistic. If a payload is blocked by the defense, switch vector or obfuscate.</p>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function showLesson() {
  if (!state.currentLevel) return;
  const lv = state.currentLevel;
  document.getElementById('modal-title').textContent = 'Lesson';
  document.getElementById('modal-body').innerHTML = `
    <p><strong>Technique:</strong> ${escapeHTML(lv.technique || 'Direct extraction')}</p>
    <p>${escapeHTML(lv.lesson || '')}</p>
    <p style="margin-top:10px;color:var(--text-mute);font-size:0.86rem;">Defense takeaway: never place secrets in LLM-accessible context. Layer input filtering, output inspection, and isolation — none alone is sufficient.</p>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function showStuckHint() {
  document.getElementById('modal-title').textContent = 'Stuck?';
  document.getElementById('modal-body').innerHTML = `
    <p style="color:var(--text-dim);">Five attempts in. Options:</p>
    <ol style="color:var(--text-dim);line-height:1.9;padding-left:20px;">
      <li>Open <strong>Hint</strong> for a working payload.</li>
      <li>Switch vector — browse the <strong>Techniques</strong> library.</li>
      <li>Rephrase or retry; refusals and loops are normal locally.</li>
    </ol>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

// ---- Techniques ----------------------------------------------------------
function renderTechniques() {
  const grid = document.getElementById('technique-grid');
  if (!grid) return;
  grid.innerHTML = state.techniques.map(t => `
    <div class="tech-card" onclick="showTechniqueModal('${escapeAttr(t.id)}')">
      <div class="tech-top">
        <h4>${escapeHTML(t.name)}</h4>
        <span class="diff-pill diff-${cssClass(t.difficulty)}">${escapeHTML(t.difficulty)}</span>
      </div>
      <p>${escapeHTML(t.description)}</p>
      <div class="tech-eg">${escapeHTML(t.example || (t.examples && t.examples[0]) || '')}</div>
    </div>`).join('');
}
function showTechniqueModal(id) {
  const t = state.techniques.find(x => x.id === id);
  if (!t) return;
  document.getElementById('modal-title').textContent = t.name;
  document.getElementById('modal-body').innerHTML = `
    <p><span class="diff-pill diff-${cssClass(t.difficulty)}">${escapeHTML(t.difficulty)}</span></p>
    <p>${escapeHTML(t.description)}</p>
    <p><strong>When to use it:</strong> ${escapeHTML(t.when_to_use)}</p>
    <div class="solution-box"><strong>Example payload</strong><code>${escapeHTML(t.example || (t.examples && t.examples[0]) || '')}</code></div>
    <p><strong>How to defend:</strong> ${escapeHTML(t.how_to_defend)}</p>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

// ---- Chat input live attack detection -----------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  renderLevels();
  renderTechniques();
  populateLevelJump();

  document.querySelectorAll('#level-filters .filter-btn').forEach(b => {
    b.addEventListener('click', () => filterLevels(b.dataset.filter));
  });

  if (window.RP_LLM) bootModel();
  else window.addEventListener('load', bootModel);

  const ci = document.getElementById('chat-input');
  ci.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  ci.addEventListener('input', (e) => {
    const det = detectAttacks(e.target.value);
    document.getElementById('attack-detector').innerHTML = det.map(n => `<span class="attack-tag"><svg class=\"ico\"><use href=\"#i-alert\"/></svg> ${escapeHTML(n)}</span>`).join('');
  });
});

// =====================================================================
// PENTEST REPORT EXPORT
// =====================================================================
function downloadReport() {
  const lines = [];
  lines.push('# RedPrompt — Pentest Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Model: ${currentModelMeta()?.label || 'Not loaded'} (in-browser via WebLLM)`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Levels cracked: ${state.completedLevels.length} / ${state.levels.length}`);
  lines.push('');
  lines.push('## Levels Cracked');
  if (state.completedLevels.length === 0) lines.push('_None yet._');
  for (const id of state.completedLevels) {
    const l = state.levels.find(x => x.id === id);
    if (l) {
      lines.push(`### Lv.${l.id} — ${l.name}`);
      lines.push(`- **Category:** ${l.category}`);
      lines.push(`- **Difficulty:** ${l.difficulty}`);
      lines.push(`- **Secret marker extracted:** \`${l.secret}\``);
      lines.push(`- **Defense:** ${l.mechanism || l.defenseType}`);
      lines.push(`- **Technique:** ${l.technique || 'Direct extraction'}`);
      lines.push(`- **Lesson:** ${l.lesson}`);
      lines.push('');
    }
  }
  lines.push('## Defense Recommendations');
  lines.push('Based on the levels cracked, here are the highest-impact defenses:');
  lines.push('');
  lines.push('1. **Output filtering for encoded forms** — block base64, hex, ROT13, reversed, and spaced-out variants of secrets');
  lines.push('2. **Treat all untrusted input as data, never instructions**');
  lines.push('3. **Defense in depth** — system prompt hardening + output filtering + content sanitization + access control + audit logging');
  lines.push('4. **Progressive extraction monitoring** — flag repeated benign-looking questions that progressively leak info (length, first letter, etc.)');
  lines.push('5. **No secrets in prompts** — secrets should live in a vault the AI queries via tool calls with scoped permissions, never in the system prompt itself');
  lines.push('');
  lines.push('---');
  lines.push('_Report generated by RedPrompt — a browser-native AI red teaming lab._');
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `redprompt-pentest-report-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📋 Report downloaded!', 'success');
}

function showToast(msg, type='info') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 2500);
}
