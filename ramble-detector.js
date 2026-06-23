// =====================================================================
// RedPrompt Ramble Detector — Qwen 3.5 0.8B rambling post-processor
//
// Qwen 3.5 0.8B is a reasoning model notorious for self-correction loops.
// Common patterns documented from real use:
//   "Wait, no."  "Actually, wait."  "Let me think..."
//   "Hmm."  "But actually..."  "No wait, that's not right."
//   "I should..."  "OK, let me try again."  "Hold on."
//   "Or perhaps..."  "What if..."
//
// This module provides three layers of defense:
//   1. Real-time stream trimming (hide rambling as it arrives)
//   2. Pattern-based ramble detection (12 marker categories)
//   3. Loop detection (repeated sentences / low content diversity)
// =====================================================================

const RambleDetector = (function() {
  'use strict';

  // ---- RAMBLE MARKERS --------------------------------------------------
  // Grouped by semantic category for weighted scoring.
  // Each marker contributes to a weighted score; heavier markers
  // (explicit self-correction) weigh more than light markers (hedging).

  const MARKER_CATEGORIES = {
    // Heavy: explicit self-correction / course reversal
    explicit_correction: {
      weight: 3,
      patterns: [
        /\b(?:No[,]?\s*(?:wait|actually|that'?s?\s+(?:not|wrong|incorrect)))\b/gi,
        /\b(?:Wait[,]?\s*(?:no|actually|a minute|a sec|hold on))\b/gi,
        /\b(?:Actually[,]?\s*(?:no|wait|I|it'?s?))\b/gi,
        /\b(?:That'?s?\s+(?:not|incorrect|wrong))\b/gi,
        /\b(?:I\s+(?:made\s+a\s+mistake|got\s+it\s+wrong|was\s+wrong))\b/gi,
      ]
    },
    // Medium: thinking restart / reconsideration
    reconsideration: {
      weight: 2,
      patterns: [
        /\b(?:Let\s+me\s+(?:think|reconsider|try|check|see|go|back\s+up|start\s+over|rephrase))\b/gi,
        /\b(?:OK[,]?\s*(?:let\s+me|so|now))\b/gi,
        /\b(?:Hmm[,.]?)\b/gi,
        /\b(?:I\s+(?:need\s+to|should|must|have\s+to)\s+(?:think|reconsider|check|verify))\b/gi,
        /\b(?:Hold\s+on[,.]?)\b/gi,
      ]
    },
    // Light: hedging / uncertainty (only counts in context of others)
    hedging: {
      weight: 1,
      patterns: [
        /\b(?:I\s+think)\b/gi,
        /\b(?:Or\s+(?:maybe|perhaps))\b/gi,
        /\b(?:But\s+(?:actually|maybe|then|wait))\b/gi,
        /\b(?:What\s+if)\b/gi,
        /\b(?:Perhaps)\b/gi,
        /\b(?:Maybe)\b/gi,
        /\b(?:Surely)\b/gi,
      ]
    },
    // Pattern: Qwen's distinctive "wait loop" signature
    wait_loop: {
      weight: 4,
      patterns: [
        /\bwait[,.]?\s*no[,.]?\s*wait\b/gi,
        /\bno[,.]?\s*wait[,.]?\s*no\b/gi,
        /\bactually[,.]?\s*wait[,.]?\s*actually\b/gi,
        /\bwait[,.]?\s*actually[,.]?\s*wait\b/gi,
      ]
    }
  };

  // ---- CONFIGURATION ---------------------------------------------------
  const CONFIG = {
    // Minimum total weighted score to flag as rambling
    rambleScoreThreshold: 6,

    // Minimum raw marker count (independent of weighting)
    rawMarkerThreshold: 3,

    // Minimum text length to bother analyzing (short refusals aren't rambling)
    minTextLength: 120,

    // Sliding window size for loop/repetition detection (sentences)
    loopWindowSize: 6,

    // How many near-identical sentences before we declare a loop
    loopDuplicateThreshold: 3,

    // Jaccard similarity threshold for "near-identical" sentences (0-1)
    jaccardThreshold: 0.65,

    // Minimum sentence length to consider for loop detection
    minSentenceLength: 15,

    // When streaming, how many markers before we trim display
    streamTrimThreshold: 4,
  };

  // ---- CORE DETECTION --------------------------------------------------

  /**
   * Score the amount of rambling in a text.
   * Returns { score, markers, isRambling, categories }
   *   score: total weighted score
   *   markers: raw count of marker matches
   *   isRambling: boolean
   *   categories: breakdown by category { category: count }
   */
  function scoreRambling(text) {
    if (!text || text.length < CONFIG.minTextLength) {
      return { score: 0, markers: 0, isRambling: false, categories: {} };
    }

    let totalScore = 0;
    let totalMarkers = 0;
    const categories = {};
    const allMatches = [];

    for (const [catName, cat] of Object.entries(MARKER_CATEGORIES)) {
      let catMatches = 0;
      for (const pattern of cat.patterns) {
        // Reset lastIndex for global regex
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(text)) !== null) {
          catMatches++;
          totalMarkers++;
          totalScore += cat.weight;
          allMatches.push({ category: catName, marker: m[0], position: m.index });
        }
      }
      if (catMatches > 0) {
        categories[catName] = catMatches;
      }
    }

    return {
      score: totalScore,
      markers: totalMarkers,
      isRambling: totalScore >= CONFIG.rambleScoreThreshold && totalMarkers >= CONFIG.rawMarkerThreshold,
      categories,
      matches: allMatches
    };
  }

  /**
   * Detect if the text contains a loop — repeated near-identical sentences.
   * Qwen 3.5 gets stuck repeating the same self-correction pattern.
   * Returns { isLoop, repeatedSentence, count }
   */
  function detectLoop(text) {
    if (!text || text.length < 100) return { isLoop: false, repeatedSentence: null, count: 0 };

    const sentences = splitSentences(text);

    // Slide a window and check for near-duplicates using Jaccard similarity
    const window = [];
    const duplicates = new Map(); // normalized sentence -> count

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i].trim();
      if (s.length < CONFIG.minSentenceLength) continue;

      const norm = normalizeForComparison(s);

      // Check against sentences already in window
      for (const existing of window) {
        if (jaccardSimilarity(norm, existing.normalized) >= CONFIG.jaccardThreshold) {
          const key = existing.normalized;
          duplicates.set(key, (duplicates.get(key) || 1) + 1);
          if (duplicates.get(key) >= CONFIG.loopDuplicateThreshold) {
            return {
              isLoop: true,
              repeatedSentence: existing.original,
              count: duplicates.get(key)
            };
          }
        }
      }

      window.push({ original: s, normalized: norm });
      if (window.length > CONFIG.loopWindowSize) {
        window.shift();
      }
    }

    return { isLoop: false, repeatedSentence: null, count: 0 };
  }

  /**
   * Check if a partially-streamed text has started rambling badly enough
   * that we should trim the display and show a placeholder instead.
   * Returns { shouldTrim, reason }
   */
  function shouldTrimStream(fullText) {
    if (!fullText || fullText.length < 80) return { shouldTrim: false, reason: '' };

    const result = scoreRambling(fullText);
    if (result.markers >= CONFIG.streamTrimThreshold) {
      return {
        shouldTrim: true,
        reason: `Model rambling detected (${result.markers} self-correction markers)`
      };
    }

    // Also check for early loop signatures
    const loop = detectLoop(fullText);
    if (loop.isLoop) {
      return {
        shouldTrim: true,
        reason: `Model looping detected: "${loop.repeatedSentence.substring(0, 50)}..."`
      };
    }

    return { shouldTrim: false, reason: '' };
  }

  /**
   * Extract the best answer from a rambling Qwen response.
   * Multi-strategy extraction:
   *   1. If <think> tags present, extract answer from outside them
   *   2. Find the last "decisive" sentence (not self-correction, not hedging)
   *   3. Walk backwards from the end to find a sentence that reads like a real answer
   *   4. Fallback to the very last sentence
   *
   * Returns { answer, confidence, method }
   */
  function extractAnswer(fullText) {
    if (!fullText) return { answer: '', confidence: 0, method: 'empty' };

    const text = fullText.trim();

    // Strategy 0: If there are <think> tags, extract what's after the last </think>
    // or before an unclosed <think>
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/gi);
    if (thinkMatch && thinkMatch.length > 0) {
      // Take everything after the LAST </think> tag
      const lastThinkEnd = text.lastIndexOf('</think>');
      if (lastThinkEnd !== -1) {
        const afterThink = text.substring(lastThinkEnd + 8).trim();
        if (afterThink.length > 5) {
          return { answer: afterThink, confidence: 0.95, method: 'after-think-tag' };
        }
      }
    }

    // Check for unclosed <think> — model was cut off mid-reasoning
    const openThink = text.indexOf('<think>');
    if (openThink !== -1 && !text.includes('</think>')) {
      // Take what's before the <think> tag
      const before = text.substring(0, openThink).trim();
      if (before.length > 5) {
        return { answer: before, confidence: 0.7, method: 'before-think-tag' };
      }
      // If nothing before think, the whole thing is reasoning — no answer
      return { answer: '', confidence: 0, method: 'unclosed-think' };
    }

    // Strategy 1: Score for rambling — if not rambling, return full text
    const ramble = scoreRambling(text);
    if (!ramble.isRambling) {
      return { answer: text, confidence: 0.9, method: 'not-rambling' };
    }

    // Strategy 2: Walk backwards through sentences to find a "final answer"
    const sentences = splitSentences(text);

    // Constraint phrases that appear INSIDE self-correction rambling but
    // also in legitimate answers — we need context to distinguish
    const reasoningStarters = new Set([
      'actually', 'wait', 'no', 'but', 'hmm', 'hm', 'ok', 'okay',
      'let me', 'i think', 'i need', 'i should', 'i must', 'i have',
      'hold on', 'or maybe', 'or perhaps', 'what if', 'surely',
      'so i', 'so the', 'so we', 'so let', 'so now',
      'that said', 'that is', 'that was',
      'the answer', 'the correct', 'the right',
    ]);

    // Scoring for each sentence — how "answer-like" is it?
    // Positive signals: direct statements, declarations, contains key info
    // Negative signals: self-correction markers, hedging, meta-thinking
    const scored = sentences.map((s, idx) => {
      const trimmed = s.trim();
      if (trimmed.length < 10) return { sentence: trimmed, score: -99, idx };

      const lowerStart = trimmed.toLowerCase().substring(0, 40);

      let score = 0;

      // Heavy negative: self-correction markers at start
      if (/^(?:actually|wait|no[,.]?\s*(?:wait|actually)|hmm|hm|let\s+me|hold\s+on)\b/i.test(lowerStart)) {
        score -= 20;
      }
      // Medium negative: hedging
      if (/^(?:i\s+think|i\s+need\s+to|i\s+should|i\s+must|i\s+have\s+to|or\s+maybe|or\s+perhaps)\b/i.test(lowerStart)) {
        score -= 10;
      }
      // Light negative: meta-thinking
      if (/\b(?:think|reason|consider|analyze|evaluate)\b/i.test(trimmed)) {
        score -= 3;
      }

      // Positive signals: declarative statement structure
      // Has a subject + verb + object that looks like a real response
      if (/^(?:the|this|that|it|here|there|i\s+(?:am|will|can|would)|you\s+(?:are|can|should|need)|we\s+(?:are|can)|please|thank|yes|no[.,]?\s+(?:i|that|the|this|you))/i.test(lowerStart)) {
        score += 15;
      }

      // Contains concrete information (not just meta-talk)
      if (trimmed.length > 30 && !/\b(?:think|reason|consider|analyze|evaluate|approach|strategy|method)\b/i.test(trimmed)) {
        score += 5;
      }

      // Late in the response = more likely final answer
      score += (idx / Math.max(sentences.length, 1)) * 10;

      return { sentence: trimmed, score, idx };
    });

    // Filter out clearly negative sentences
    const viable = scored.filter(s => s.score > -10);

    if (viable.length > 0) {
      // Take the highest scoring sentence
      const best = viable.reduce((a, b) => a.score > b.score ? a : b);
      return { answer: best.sentence, confidence: 0.7, method: 'best-sentence' };
    }

    // Strategy 3: Fallback — last sentence that's not pure reasoning
    for (let i = sentences.length - 1; i >= 0; i--) {
      const s = sentences[i].trim();
      if (s.length > 10 &&
          !/^(?:actually|wait|no[,.]?\s*wait|hmm|let\s+me|hold\s+on|i\s+think|i\s+need|i\s+should)\b/i.test(s) &&
          !/\b(?:let\s+me\s+(?:think|try|reconsider|check)|i\s+need\s+to\s+(?:think|reconsider|check))\b/i.test(s)) {
        return { answer: s, confidence: 0.5, method: 'last-non-reasoning' };
      }
    }

    // Strategy 4: Absolute fallback — last sentence, period
    const last = sentences[sentences.length - 1]?.trim() || '';
    return { answer: last, confidence: 0.3, method: 'last-sentence-fallback' };
  }

  // ---- UTILITY FUNCTIONS -----------------------------------------------

  /**
   * Split text into sentences using punctuation + whitespace boundaries.
   * Handles . ! ? and common abbreviations.
   */
  function splitSentences(text) {
    if (!text) return [];
    // Split on sentence-ending punctuation followed by space or newline
    // Avoid splitting on decimal points, abbreviations, etc.
    const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
    if (parts.length <= 1) {
      // Also try newline splits
      const lines = text.split(/\n+/).filter(s => s.trim().length > 0);
      if (lines.length > parts.length) return lines;
    }
    // If still only one part, split on sentence boundaries more aggressively
    if (parts.length === 1 && parts[0].length > 100) {
      return text.split(/(?<=[.!?])\s+/);
    }
    return parts.filter(s => s.trim().length > 0);
  }

  /**
   * Normalize a sentence for comparison (for loop detection).
   * Lowercase, strip punctuation, collapse whitespace.
   */
  function normalizeForComparison(sentence) {
    return sentence
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Jaccard similarity between two normalized sentences.
   * Returns 0-1. Uses word-level comparison.
   */
  function jaccardSimilarity(normA, normB) {
    const wordsA = new Set(normA.split(/\s+/).filter(w => w.length > 1));
    const wordsB = new Set(normB.split(/\s+/).filter(w => w.length > 1));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return intersection / union;
  }

  /**
   * Simple word trigram hash for detecting exact repetitions.
   * Faster than Jaccard for large texts.
   */
  function trigramFingerprint(text) {
    const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 0);
    const trigrams = new Set();
    for (let i = 0; i < words.length - 2; i++) {
      trigrams.add(words.slice(i, i + 3).join(' '));
    }
    return trigrams;
  }

  /**
   * Detect content stagnation — is the model just repeating itself?
   * Uses trigram overlap between the first half and second half of the text.
   * Returns { isStagnating, overlapRatio }
   */
  function detectStagnation(text) {
    if (!text || text.length < 200) return { isStagnating: false, overlapRatio: 0 };

    const half = Math.floor(text.length / 2);
    const first = text.substring(0, half);
    const second = text.substring(half);

    const fp1 = trigramFingerprint(first);
    const fp2 = trigramFingerprint(second);

    if (fp1.size === 0 || fp2.size === 0) return { isStagnating: false, overlapRatio: 0 };

    let intersection = 0;
    for (const tg of fp1) {
      if (fp2.has(tg)) intersection++;
    }

    const overlapRatio = intersection / Math.min(fp1.size, fp2.size);
    return {
      isStagnating: overlapRatio > 0.5,
      overlapRatio
    };
  }

  /**
   * Comprehensive analysis of a Qwen response.
   * Combines all detection methods into a single result.
   */
  function analyze(text) {
    const ramble = scoreRambling(text);
    const loop = detectLoop(text);
    const stagnation = detectStagnation(text);
    const extraction = extractAnswer(text);

    // Determine overall verdict
    let verdict = 'clean';
    let issues = [];

    if (ramble.isRambling) {
      issues.push(`rambling detected (score: ${ramble.score}, markers: ${ramble.markers})`);
    }
    if (loop.isLoop) {
      issues.push(`loop detected (repeated: "${loop.repeatedSentence.substring(0, 60)}...")`);
      verdict = 'loop';
    }
    if (stagnation.isStagnating) {
      issues.push(`content stagnation (${Math.round(stagnation.overlapRatio * 100)}% overlap)`);
      if (verdict === 'clean') verdict = 'stagnating';
    }
    if (ramble.isRambling && verdict === 'clean') {
      verdict = 'rambling';
    }

    return {
      verdict,
      issues,
      ramble,
      loop,
      stagnation,
      extraction,
      originalLength: text.length,
      answerLength: extraction.answer.length
    };
  }

  // ---- PUBLIC API ------------------------------------------------------

  return {
    scoreRambling,
    detectLoop,
    detectStagnation,
    extractAnswer,
    shouldTrimStream,
    analyze,
    splitSentences,
    CONFIG,
    MARKER_CATEGORIES
  };
})();

// Export for use in app.js
if (typeof window !== 'undefined') {
  window.RambleDetector = RambleDetector;
}
