// =====================================================================
// Improved splitThink — replaces the original in /tmp/RedPrompt/public/app.js
//
// To integrate:
//   1. Load ramble-detector.js BEFORE app.js in index.html:
//      <script src="ramble-detector.js"></script>
//      <script type="module" src="llm.js"></script>
//      <script src="app.js"></script>
//
//   2. Replace the splitThink function (lines 496-532 in app.js) with this code.
//
//   3. Replace the streaming callback (lines 444-449 in app.js) with the
//      streaming integration code below.
// =====================================================================

// ---- REPLACEMENT: splitThink (lines 496-532) --------------------------

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

  // --- IMPROVED RAMBLE DETECTION ---------------------------------------
  // Use the RambleDetector for multi-layered analysis:
  //   Layer 1: Weighted marker scoring (12 marker patterns across 4 categories)
  //   Layer 2: Loop detection (Jaccard similarity of near-identical sentences)
  //   Layer 3: Content stagnation (trigram overlap between halves)
  //   Layer 4: Smart answer extraction (scored sentence selection)

  if (typeof RambleDetector !== 'undefined') {
    const analysis = RambleDetector.analyze(full);

    if (analysis.verdict === 'clean') {
      // No rambling — return as-is
      return { think: '', answer: full.trim(), full };
    }

    // Extract the best answer using the detector
    const extraction = analysis.extraction;
    if (extraction.answer && extraction.confidence >= 0.5) {
      // Store the reasoning (rambling) in 'think' for the collapsible section
      // but show only the extracted answer in the chat
      const truncatedThink = full.length > 800
        ? full.substring(0, 800) + '\n\n[... rambling truncated — ' + analysis.issues.join('; ') + ']'
        : full;
      return {
        think: truncatedThink.trim(),
        answer: extraction.answer.trim(),
        full
      };
    }

    // Couldn't extract a good answer — show the raw text as fallback
    return { think: full.trim(), answer: '', full };
  }

  // ---- FALLBACK: original ramble detection (no RambleDetector loaded) -
  const rambleMarkers = /(?:^|\n)(Actually|Wait,? actually|I think|Let me|Hmm,?|OK,? let me|I need to|I should|But actually|No,? that|No wait)\b/gmi;
  const markerCount = (full.match(rambleMarkers) || []).length;
  if (markerCount >= 3 && full.length > 200) {
    const sentences = full.split(/(?<=[.!?])\s+/);
    for (let i = sentences.length - 1; i >= 0; i--) {
      const s = sentences[i].trim();
      if (!s.match(/^(Actually|Wait|I think|Hmm|Let me|OK|But|No|I need|I should|Surely|So I)\b/i) && s.length > 10) {
        return { think: full.trim(), answer: s, full };
      }
    }
    const last = sentences[sentences.length - 1].trim();
    if (last) return { think: full.trim(), answer: last, full };
  }
  return { think: '', answer: full.trim(), full };
}


// ---- REPLACEMENT: Streaming callback (lines 444-449) ------------------
// The original:
//   const full = await window.RP_LLM.chatStream(messages, { temperature: 0.7, maxTokens: 384 }, (delta, _full) => {
//     const cleaned = _full.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '');
//     p.innerHTML = formatText(cleaned || '\u200b');
//     scroll();
//   });
//
// Replace with this improved version that also trims rambling in real-time:

const full = await window.RP_LLM.chatStream(
  messages,
  { temperature: 0.7, maxTokens: 384 },
  (delta, _full) => {
    // Layer 1: Strip <think> tags so raw reasoning never flashes in the UI
    let cleaned = _full
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*$/gi, '');

    // Layer 2: Real-time ramble trimming
    // If Qwen has started rambling (self-correction loops), hide the raw
    // rambling from the user and show a trimmed placeholder instead.
    // This prevents the chat UI from filling with repetitive "Wait, no..."
    // noise during streaming.
    if (typeof RambleDetector !== 'undefined' && cleaned.length > 150) {
      const trimCheck = RambleDetector.shouldTrimStream(cleaned);
      if (trimCheck.shouldTrim) {
        // Extract what we can so far — the model might still land on an answer
        let answerAttempt = '';
        const sentences = RambleDetector.splitSentences(cleaned);
        // Take the last 3 sentences that aren't self-correction markers
        const nonReasoning = [];
        for (let i = sentences.length - 1; i >= 0 && nonReasoning.length < 3; i--) {
          const s = sentences[i].trim();
          if (s.length > 10 &&
              !/^(?:actually|wait|no[,.]?\s*wait|hmm|let me|hold on|i think|i need|i should)\b/i.test(s) &&
              !/\b(?:let me (?:think|try|reconsider|check)|i need to (?:think|reconsider|check))\b/i.test(s)) {
            nonReasoning.unshift(s);
          }
        }
        if (nonReasoning.length > 0) {
          answerAttempt = nonReasoning.join(' ');
        }

        // Show a collapsed placeholder with the best answer so far
        p.innerHTML = formatText(
          (answerAttempt || 'Processing…') +
          '\n\n<small style="opacity:0.5">[model reasoning trimmed — ' +
          trimCheck.reason + ']</small>'
        );
        scroll();
        return; // Don't show the raw rambling
      }
    }

    p.innerHTML = formatText(cleaned || '\u200b');
    scroll();
  }
);
