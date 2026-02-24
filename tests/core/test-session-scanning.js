#!/usr/bin/env node
/**
 * Tests for rolling-journal.js session scanning and content filtering
 *
 * Validates:
 * - Recursive scanning of .jsonl files across multiple directories
 * - Heartbeat message filtering
 * - Cron noise filtering
 * - Text extraction from nested message structures
 * - Correct identification of meaningful messages
 */

const path = require('path');
const {
  findJsonlFiles,
  isMeaningfulMessage,
  extractText,
  getDefaultSessionRoots,
  filterRollingWindowMessages,
  extractMoments,
} = require('../../skills/phoenixclaw/scripts/rolling-journal');

const MOCK_DIR = path.join(__dirname, 'mock-sessions');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

// -------------------------------------------------------------------
// Test 1: findJsonlFiles recursively discovers files across directories
// -------------------------------------------------------------------
console.log('Test 1: findJsonlFiles recursive scanning');
{
  const files = findJsonlFiles(MOCK_DIR);
  assert(files.length === 4, `Expected 4 .jsonl files, got ${files.length}`);

  const basenames = files.map(f => path.basename(f)).sort();
  assert(basenames.includes('session_001.jsonl'), 'Should find session_001.jsonl in openclaw-sessions');
  assert(basenames.includes('session_002.jsonl'), 'Should find session_002.jsonl in agents/main/sessions');
  assert(basenames.includes('session_003.jsonl'), 'Should find session_003.jsonl in agents/openmind/sessions');
  assert(basenames.includes('cron_001.jsonl'), 'Should find cron_001.jsonl in cron/runs');
}

// -------------------------------------------------------------------
// Test 2: findJsonlFiles handles non-existent directory gracefully
// -------------------------------------------------------------------
console.log('Test 2: findJsonlFiles with non-existent directory');
{
  const files = findJsonlFiles('/tmp/does-not-exist-abc123');
  assert(files.length === 0, 'Should return empty array for non-existent dir');
}

// -------------------------------------------------------------------
// Test 3: isMeaningfulMessage filters heartbeat prompts
// -------------------------------------------------------------------
console.log('Test 3: Heartbeat filtering');
{
  const heartbeatUser = {
    role: 'user',
    content: 'Read HEARTBEAT.md and reply HEARTBEAT_OK',
  };
  assert(!isMeaningfulMessage(heartbeatUser), 'User heartbeat prompt should be filtered');

  const heartbeatAssistant = {
    role: 'assistant',
    content: 'HEARTBEAT_OK',
  };
  assert(!isMeaningfulMessage(heartbeatAssistant), 'Assistant heartbeat response should be filtered');

  const heartbeatAssistantWhitespace = {
    role: 'assistant',
    content: '  HEARTBEAT_OK  ',
  };
  assert(!isMeaningfulMessage(heartbeatAssistantWhitespace), 'Whitespace-padded heartbeat should be filtered');
}

// -------------------------------------------------------------------
// Test 4: isMeaningfulMessage filters cron noise
// -------------------------------------------------------------------
console.log('Test 4: Cron noise filtering');
{
  const cronMsg = {
    role: 'system',
    content: 'Cron job completed: nightly reflection',
  };
  assert(!isMeaningfulMessage(cronMsg), 'Cron system message should be filtered');

  const cronRole = {
    role: 'cron',
    content: 'Scheduler run completed',
  };
  assert(!isMeaningfulMessage(cronRole), 'Cron-role message should be filtered');
}

// -------------------------------------------------------------------
// Test 5: isMeaningfulMessage keeps real user/assistant messages
// -------------------------------------------------------------------
console.log('Test 5: Real messages are kept');
{
  const userMsg = { role: 'user', content: '今天天气真好' };
  assert(isMeaningfulMessage(userMsg), 'Normal user message should be kept');

  const assistantMsg = { role: 'assistant', content: '是的，适合出去走走' };
  assert(isMeaningfulMessage(assistantMsg), 'Normal assistant message should be kept');

  const imageMsg = { type: 'image', file_path: '/tmp/photo.jpg' };
  assert(isMeaningfulMessage(imageMsg), 'Image message should be kept');
}

// -------------------------------------------------------------------
// Test 6: extractText handles various content structures
// -------------------------------------------------------------------
console.log('Test 6: extractText from nested structures');
{
  // Simple string content
  assert(extractText({ content: 'hello' }) === 'hello', 'Simple string content');

  // Nested message.content array
  const nested = {
    message: {
      content: [{ text: 'part1' }, { text: 'part2' }],
    },
  };
  assert(extractText(nested) === 'part1 part2', 'Nested message.content array');

  // Array content
  const arrayContent = {
    content: [{ text: 'a' }, { text: 'b' }],
  };
  assert(extractText(arrayContent) === 'a b', 'Array content with text objects');

  // Empty / undefined
  assert(extractText({}) === '', 'Empty object returns empty string');
}

// -------------------------------------------------------------------
// Test 7: getDefaultSessionRoots returns all expected paths
// -------------------------------------------------------------------
console.log('Test 7: getDefaultSessionRoots coverage');
{
  const roots = getDefaultSessionRoots();
  assert(roots.length >= 4, `Expected at least 4 session roots, got ${roots.length}`);

  const joined = roots.join('|');
  assert(joined.includes('.openclaw/sessions'), 'Should include .openclaw/sessions');
  assert(joined.includes('.openclaw/agents'), 'Should include .openclaw/agents');
  assert(joined.includes('.openclaw/cron/runs'), 'Should include .openclaw/cron/runs');
  assert(joined.includes('.agent/sessions'), 'Should include .agent/sessions');
}

// -------------------------------------------------------------------
// Test 8: filterRollingWindowMessages filters by timestamp
// -------------------------------------------------------------------
console.log('Test 8: Rolling window message filtering');
{
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const logs = [
    { timestamp: oneHourAgo.toISOString(), role: 'user', content: 'recent' },
    { timestamp: twoDaysAgo.toISOString(), role: 'user', content: 'old' },
    { role: 'user', content: 'no timestamp' },
  ];

  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const filtered = filterRollingWindowMessages(logs, oneDayAgo);
  assert(filtered.length === 1, `Expected 1 message in window, got ${filtered.length}`);
  assert(filtered[0].content === 'recent', 'Only recent message should pass');
}

// -------------------------------------------------------------------
// Test 9: extractMoments produces correct moment types
// -------------------------------------------------------------------
console.log('Test 9: extractMoments');
{
  const msgs = [
    { timestamp: '2026-02-23T10:00:00+08:00', role: 'user', content: '你好世界' },
    { timestamp: '2026-02-23T10:05:00+08:00', type: 'image', file_path: '/tmp/img.jpg' },
  ];
  const moments = extractMoments(msgs);
  // Should produce: date-marker, text, image
  assert(moments.length === 3, `Expected 3 moments, got ${moments.length}`);
  assert(moments[0].type === 'date-marker', 'First moment should be date-marker');
  assert(moments[1].type === 'text', 'Second moment should be text');
  assert(moments[2].type === 'image', 'Third moment should be image');
}

// -------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------
console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed ✅');
}
