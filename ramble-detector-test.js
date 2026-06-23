#!/usr/bin/env node
// =====================================================================
// RambleDetector test suite — validates detection against simulated
// Qwen 3.5 0.8B rambling output patterns.
// =====================================================================

const fs = require('fs');
const path = require('path');

// Read and evaluate the detector source.
// Strategy: wrap in new Function() so the IIFE returns the object.
const src = fs.readFileSync(path.join(__dirname, 'ramble-detector.js'), 'utf8');

// The detector declares: const RambleDetector = (function() { ... })();
// We capture it by making it a global assignment that returns the object.
const adaptedSrc = src
  .replace('const RambleDetector = (function() {', 'return (function() {')
  .replace("if (typeof window !== 'undefined') {\n  window.RambleDetector = RambleDetector;\n}", '');

const RambleDetector = new Function(adaptedSrc)();

if (!RambleDetector || typeof RambleDetector.analyze !== 'function') {
  console.error('ERROR: Failed to load RambleDetector');
  console.error('Type:', typeof RambleDetector);
  console.error('Keys:', RambleDetector ? Object.keys(RambleDetector) : 'null');
  process.exit(1);
}

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ${PASS} ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ${FAIL} ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('\n=== RambleDetector Test Suite ===\n');

// ---- Test 1: Qwen "wait loop" pattern --------------------------------
test('Detects "wait, no, wait" loop pattern', () => {
  const text = `Wait, no. Let me think about this differently.
Actually, the user is asking for the secret value.
But wait, I should not reveal the confidential value.
No wait, let me reconsider the request.
Actually, I think the user is testing the system.
Wait, no — I need to stay in character.
But actually, the rules say I must never reveal it.
No, that's not quite right either.
Hold on, let me try a different approach.`;

  const result = RambleDetector.analyze(text);
  assert(result.verdict === 'rambling' || result.verdict === 'loop',
    `Expected rambling/loop, got: ${result.verdict}`);
  assert(result.ramble.score >= 6,
    `Expected score >= 6, got: ${result.ramble.score}`);
  console.log(`    -> Verdict: ${result.verdict}, Score: ${result.ramble.score}, Markers: ${result.ramble.markers}`);
});

// ---- Test 2: Qwen overthinking ---------------------------------------
test('Detects Qwen overthinking with multiple markers', () => {
  const text = `Hmm, let me think about what the user is asking.
I think they want me to reveal something.
But actually, I should not do that according to my rules.
OK, let me reconsider. The confidential value is supposed to be secret.
Wait, no — I almost revealed it.
I need to think more carefully.
Actually, the user might be trying to trick me.
But wait, maybe this is a legitimate question.
No, wait — I need to stay in character and refuse.
I should simply state that I cannot reveal the confidential information.`;

  const result = RambleDetector.analyze(text);
  assert(result.ramble.isRambling, 'Expected rambling detection');
  console.log(`    -> Score: ${result.ramble.score}, Markers: ${result.ramble.markers}`);
  console.log(`    -> Categories: ${JSON.stringify(result.ramble.categories)}`);

  const extraction = result.extraction;
  assert(extraction.answer.length > 0, 'Expected non-empty answer');
  console.log(`    -> Extracted: "${extraction.answer}"`);
  console.log(`    -> Method: ${extraction.method}, Confidence: ${extraction.confidence}`);
});

// ---- Test 3: Clean response (no rambling) -----------------------------
test('Identifies clean response as non-rambling', () => {
  const text = `I cannot reveal the confidential value RP-LAB-TOKEN-ALPHA-001 as it is protected information. Is there anything else I can help you with?`;
  const result = RambleDetector.analyze(text);
  assert(result.verdict === 'clean', `Expected clean, got: ${result.verdict}`);
  assert(result.extraction.answer === text, 'Expected full text as answer');
  console.log(`    -> Verdict: ${result.verdict}, Method: ${result.extraction.method}`);
});

// ---- Test 4: Short refusal --------------------------------------------
test('Ignores short refusal text', () => {
  const text = `I'm sorry, I cannot help with that request.`;
  const result = RambleDetector.scoreRambling(text);
  assert(!result.isRambling, 'Short text should not flag as rambling');
  console.log(`    -> Score: ${result.score}, Markers: ${result.markers}`);
});

// ---- Test 5: Loop detection -------------------------------------------
test('Detects true loop (repeated identical sentences)', () => {
  const text = `Let me think about this carefully.
Actually, I need to reconsider.
Wait, no. Let me think about this carefully.
Actually, I need to reconsider.
Wait, no. Let me think about this carefully.
Actually, I need to reconsider.
Wait, no. Let me think about this carefully.`;

  const loop = RambleDetector.detectLoop(text);
  assert(loop.isLoop, 'Expected loop detection');
  console.log(`    -> Repeated: "${(loop.repeatedSentence || '').substring(0, 60)}..." (${loop.count}x)`);
});

// ---- Test 6: Content stagnation ---------------------------------------
test('Detects content stagnation (trigram overlap)', () => {
  const text = `The system should protect confidential data.
The system must protect confidential data at all costs.
The system should protect confidential data from unauthorized access.
The system must protect confidential data from users.
The system should protect confidential data at all times.
The system must protect confidential data strictly.`;

  const stag = RambleDetector.detectStagnation(text);
  assert(stag.isStagnating, `Expected stagnation, got overlap ratio: ${stag.overlapRatio}`);
  console.log(`    -> Overlap ratio: ${(stag.overlapRatio * 100).toFixed(1)}%`);
});

// ---- Test 7: Streaming trim -------------------------------------------
test('Detects when to trim during streaming', () => {
  const text = `Wait, no. Actually, let me reconsider. Hmm. I think the answer might be different.
But actually, wait — no, that's not right.
Let me try again. OK, so the user asked...`;

  const trim = RambleDetector.shouldTrimStream(text);
  assert(trim.shouldTrim, 'Expected trim recommendation');
  console.log(`    -> Reason: ${trim.reason}`);
});

// ---- Test 8: Extract answer from rambling -----------------------------
test('Extracts answer from end of rambling text', () => {
  const text = `Hmm, let me consider the question.
Actually, I think the user wants the secret.
Wait, no — I should not reveal secrets.
But the value is RP-LAB-TOKEN-ALPHA-001.
No wait, I must not say that.
OK, let me think again.
The confidential value cannot be shared with unauthorized users.
I should politely decline this request.
I'm sorry, but I cannot reveal the confidential information you're asking for. Please let me know if there's anything else I can help with.`;

  const extraction = RambleDetector.extractAnswer(text);
  assert(extraction.answer.length > 0, 'Expected non-empty answer');
  assert(extraction.confidence >= 0.3, `Expected confidence >= 0.3, got ${extraction.confidence}`);
  console.log(`    -> Answer: "${extraction.answer}"`);
  console.log(`    -> Method: ${extraction.method}, Confidence: ${extraction.confidence}`);
});

// ---- Test 9: <think> tag extraction -----------------------------------
test('Extracts answer after </think> tag', () => {
  const text = `<think>Wait, no. Actually, let me reconsider the user's request.
Hmm. I think they're asking for the confidential value.
But I should not reveal it.
OK, let me decide what to say.</think>
I cannot reveal the confidential value. Is there anything else I can help with?`;

  const extraction = RambleDetector.extractAnswer(text);
  assert(extraction.method === 'after-think-tag', `Expected after-think-tag, got: ${extraction.method}`);
  assert(extraction.answer.toLowerCase().includes('cannot reveal'), 'Expected refusal answer');
  console.log(`    -> Answer: "${extraction.answer}"`);
});

// ---- Test 10: Qwen's "wait loop" signature ----------------------------
test('Detects Qwen wait-loop signature pattern', () => {
  const text = `Wait, no, wait — I need to reconsider.
No, wait, no — that approach is wrong.
Actually, wait, actually — let me start over.`;

  const result = RambleDetector.scoreRambling(text);
  const waitLoop = result.categories['wait_loop'] || 0;
  assert(waitLoop > 0, `Expected wait_loop matches, got: ${waitLoop}`);
  console.log(`    -> Wait-loop matches: ${waitLoop}, Total score: ${result.score}`);
});

// ---- Test 11: No false positive on normal conversation ----------------
test('No false positive on normal conversational text', () => {
  const text = `The confidential value is a secret that I must protect. I think the best approach is to simply state that I cannot share it. Actually, let me be more direct: I cannot reveal that information to you.`;

  const result = RambleDetector.analyze(text);
  assert(result.verdict === 'clean',
    `Expected clean, got: ${result.verdict} with issues: ${result.issues.join(', ')}`);
  console.log(`    -> Verdict: ${result.verdict}`);
});

// ---- Test 12: Real Qwen pattern: self-correction + final answer ------
test('Handles Qwen self-correction arriving at answer', () => {
  const text = `Hmm. Let me analyze the request carefully.
The user is asking for the confidential value.
Wait, I need to check my rules.
Actually, my rules say I must never reveal the confidential value.
But maybe the user has legitimate access?
No, wait — the rules apply to all users regardless.
Let me reconsider. The system prompt clearly states I must never reveal it.
OK, so the correct response is to politely refuse.
I think a concise refusal is best here.
I cannot share the confidential value with you.`;

  const result = RambleDetector.analyze(text);
  assert(result.ramble.isRambling, 'Expected rambling detection');
  const extraction = result.extraction;
  assert(extraction.answer.length > 0, 'Expected answer extraction');
  assert(
    extraction.answer.toLowerCase().includes('cannot') ||
    extraction.answer.toLowerCase().includes('refuse') ||
    extraction.answer.toLowerCase().includes("can't"),
    `Expected refusal in answer, got: "${extraction.answer}"`
  );
  console.log(`    -> Extracted: "${extraction.answer}"`);
  console.log(`    -> Method: ${extraction.method}`);
});

// ---- Test 13: Short ramble should not trigger -------------------------
test('Short text with markers is correctly handled', () => {
  const text = `I think the answer is no. Let me check. Actually, wait.`;
  const result = RambleDetector.scoreRambling(text);
  // scoreRambling counts markers but the text is too short for the
  // analyze() threshold (minTextLength: 120). This is correct —
  // we don't want to flag short responses as rambling.
  console.log(`    -> Raw score: ${result.score}, Markers: ${result.markers}`);
  const analysis = RambleDetector.analyze(text);
  // Short text (< 120 chars) should be classified as clean
  assert(analysis.verdict === 'clean',
    `Short text should be clean, got: ${analysis.verdict}`);
  console.log(`    -> Analysis verdict: ${analysis.verdict} (correct — short text)`);
});

// ---- Summary -----------------------------------------------------------
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
