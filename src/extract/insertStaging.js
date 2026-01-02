/**
 * Insert validated items into dev_ai_smart_extractions staging table
 * Susan's sorter will pick them up and route to final tables
 * 
 * CRITICAL: Items without project_id are REJECTED (no orphans)
 */

const db = require('../lib/db');
const { Logger } = require('../lib/logger');
const { resolveProjectId } = require('../lib/resolveProject');
const crypto = require('crypto');

const logger = new Logger('Jason:InsertStaging');

function generateHash(item) {
  const data = [
    item.title || '',
    (item.content || '').substring(0, 200),
    item.evidence?.[0]?.session_id || ''
  ].join('|');
  return crypto.createHash('md5').update(data).digest('hex');
}

async function isDuplicate(hash) {
  try {
    const { data, error } = await db.from('dev_ai_smart_extractions')
      .select('id')
      .eq('hash', hash)
      .limit(1);
    return !error && data && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Insert items into staging table
 * REJECTS items if project_id cannot be resolved
 */
async function insertStaging(items, sessionId, projectSlug = null) {
  let inserted = 0;
  let duplicates = 0;
  let rejected = 0;

  // Resolve project_slug to UUID - REQUIRED
  const projectId = projectSlug ? await resolveProjectId(projectSlug) : null;
  
  // CRITICAL: If no project_id, reject ALL items from this session
  if (!projectId) {
    logger.error('REJECTED: Cannot resolve project_id', { 
      slug: projectSlug, 
      sessionId,
      itemCount: items.length 
    });
    return { inserted: 0, duplicates: 0, rejected: items.length, error: 'project_id unresolved' };
  }

  logger.info('Resolved project', { slug: projectSlug, projectId: projectId.substring(0, 8) });

  for (const item of items) {
    try {
      const hash = generateHash(item);

      if (await isDuplicate(hash)) {
        duplicates++;
        continue;
      }

      const row = {
        bucket: item.bucket,
        category: mapBucketToCategory(item.bucket),
        content: item.content,
        title: item.title || item.content.substring(0, 200).split('\n')[0],
        priority: item.priority || 'medium',
        status: 'pending',
        session_id: sessionId,
        project_id: projectId,
        hash: hash,
        metadata: {
          evidence: item.evidence,
          extractor: 'jason-v1',
          project_slug: projectSlug,
          extracted_at: new Date().toISOString()
        },
        created_at: new Date().toISOString()
      };

      const { error } = await db.from('dev_ai_smart_extractions').insert(row);
      if (error) {
        logger.error('Insert failed', { error: error.message, bucket: item.bucket });
        rejected++;
      } else {
        inserted++;
      }
    } catch (err) {
      logger.error('Error inserting item', { error: err.message });
      rejected++;
    }
  }

  logger.info('Staging insert complete', { 
    inserted, 
    duplicates, 
    rejected,
    projectId: projectId.substring(0, 8)
  });
  
  return { inserted, duplicates, rejected };
}

function mapBucketToCategory(bucket) {
  const map = {
    'Bugs Open': 'bug', 'Bugs Fixed': 'bug', 'Todos': 'todo',
    'Journal': 'general', 'Work Log': 'general', 'Ideas': 'knowledge',
    'Decisions': 'decision', 'Lessons': 'lesson', 'System Breakdown': 'knowledge',
    'How-To Guide': 'knowledge', 'Schematic': 'knowledge', 'Reference': 'knowledge',
    'Naming Conventions': 'config', 'File Structure': 'config',
    'Database Patterns': 'config', 'API Patterns': 'config',
    'Component Patterns': 'config', 'Quirks & Gotchas': 'knowledge',
    'Snippets': 'knowledge', 'Other': 'general'
  };
  return map[bucket] || 'general';
}

module.exports = { insertStaging, generateHash, isDuplicate };
