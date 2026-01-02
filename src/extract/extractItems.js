/**
 * Extract items from transcript content
 *
 * STRICT EXTRACTION - only explicit markers
 * - TODO: / FIXME: / ACTION ITEM:
 * - BUG: / ISSUE: / ERROR:
 * - DECISION:
 * - [ ] checkbox items
 * 
 * NO loose patterns like "should/must/need to"
 * NO PAID API CALLS
 */

const { Logger } = require('../lib/logger');

const logger = new Logger('Jason:ExtractItems');

// STRICT patterns only - explicit markers
const PATTERNS = {
  todo: [
    /^\s*TODO:\s*(.{10,200})$/gmi,
    /^\s*FIXME:\s*(.{10,200})$/gmi,
    /^\s*ACTION ITEM:\s*(.{10,200})$/gmi,
    /^\s*(?:-|\*)\s*\[\s*\]\s+(.{10,200})$/gm,
  ],
  bug: [
    /^\s*BUG:\s*(.{10,200})$/gmi,
    /^\s*ISSUE:\s*(.{10,200})$/gmi,
    /^\s*ERROR:\s*(.{10,200})$/gmi,
  ],
  decision: [
    /^\s*DECISION:\s*(.{10,200})$/gmi,
    /^\s*DECIDED:\s*(.{10,200})$/gmi,
  ]
};

/**
 * Generate a worklog WITHOUT LLM
 */
function generateWorklog(content, session) {
  const slug = session.project_slug || 'unknown';
  
  const userTurns = (content.match(/^USER:/gm) || []).length;
  const assistantTurns = (content.match(/^ASSISTANT:/gm) || []).length;
  
  const firstUserMatch = content.match(/^USER:\s*(.{20,200})/m);
  const topic = firstUserMatch ? firstUserMatch[1].split('\n')[0].trim() : 'Development work';
  
  return {
    bucket: 'Work Log',
    title: `${slug}: ${topic.substring(0, 80)}`,
    content: `Development session on ${slug}. ${userTurns + assistantTurns} conversation turns.`,
    tags: [slug],
    evidence: [{
      session_id: session.id,
      excerpt: topic,
      location: 'session-summary'
    }]
  };
}

/**
 * Extract with STRICT patterns only
 */
function extractWithRules(content, session) {
  const items = [];
  const seen = new Set();

  for (const pattern of PATTERNS.todo) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const text = match[1]?.trim();
      if (text && text.length >= 10 && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        items.push({
          bucket: 'Todos',
          title: text.substring(0, 150),
          content: text,
          priority: 'medium',
          evidence: [{ session_id: session.id, excerpt: match[0].substring(0, 150), location: 'strict-marker' }]
        });
      }
    }
  }

  for (const pattern of PATTERNS.bug) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const text = match[1]?.trim();
      if (text && text.length >= 10 && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        items.push({
          bucket: 'Bugs Open',
          title: text.substring(0, 150),
          content: text,
          priority: 'high',
          evidence: [{ session_id: session.id, excerpt: match[0].substring(0, 150), location: 'strict-marker' }]
        });
      }
    }
  }

  for (const pattern of PATTERNS.decision) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const text = match[1]?.trim();
      if (text && text.length >= 10 && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        items.push({
          bucket: 'Decisions',
          title: text.substring(0, 150),
          content: text,
          evidence: [{ session_id: session.id, excerpt: match[0].substring(0, 150), location: 'strict-marker' }]
        });
      }
    }
  }

  return items;
}

/**
 * Main extraction - NO LLM
 */
async function extractItems(transcript, session) {
  if (!transcript || !transcript.content) {
    return [];
  }

  const items = [];

  // Always generate 1 worklog per session
  const worklog = generateWorklog(transcript.content, session);
  items.push(worklog);

  // Extract with strict patterns
  const ruleItems = extractWithRules(transcript.content, session);
  items.push(...ruleItems);

  logger.info('Extraction complete', {
    sessionId: session.id,
    slug: session.project_slug,
    worklog: 1,
    todos: ruleItems.filter(i => i.bucket === 'Todos').length,
    bugs: ruleItems.filter(i => i.bucket.includes('Bug')).length,
    decisions: ruleItems.filter(i => i.bucket === 'Decisions').length
  });

  return items;
}

module.exports = { extractItems, extractWithRules, generateWorklog };
