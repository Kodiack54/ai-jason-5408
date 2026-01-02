/**
 * Select sessions to process for extraction
 *
 * Selection priority:
 * 1. Slug must match allowlist (truth gate)
 * 2. Not already extracted
 * 3. Status filter (optional - for bring-up, skip until Jen stamps properly)
 */

const db = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Jason:SelectSessions');

/**
 * Parse duration string to milliseconds
 * @param {string} duration - e.g., '30m', '1h', '24h'
 */
function parseDuration(duration) {
  const match = duration.match(/^(\d+)(m|h|d)$/);
  if (!match) return 30 * 60 * 1000; // Default 30 minutes

  const [, value, unit] = match;
  const ms = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return parseInt(value, 10) * ms[unit];
}

/**
 * Select sessions ready for extraction
 * @param {Object} options
 * @param {string} options.sessionId - Specific session ID (optional)
 * @param {string} options.since - Lookback duration (e.g., '30m')
 * @param {string[]} options.slugs - Allowed project slugs (REQUIRED for filtering)
 * @param {number} options.limit - Max sessions to return
 * @param {string|null} options.status - Required status (null = any status)
 */
async function selectSessions(options = {}) {
  const {
    sessionId,
    since = '30m',
    slugs = [],
    limit = 10,
    status = null  // null = don't filter by status (bring-up mode)
  } = options;

  try {
    // If specific session requested
    if (sessionId) {
      const { data, error } = await db.from('dev_ai_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error) {
        logger.error('Error fetching session', { sessionId, error: error.message });
        return [];
      }

      return data ? [data] : [];
    }

    // Calculate cutoff time
    const cutoffMs = parseDuration(since);
    const cutoffTime = new Date(Date.now() - cutoffMs).toISOString();

    // Build query - start with time filter and ordering
    let query = db.from('dev_ai_sessions')
      .select('*')
      .gte('created_at', cutoffTime)
      .not('status', 'eq', 'extracted')  // Never re-extract
      .order('created_at', { ascending: true })
      .limit(limit * 3);  // Fetch more, filter by slug after

    // Add status filter only if specified
    if (status) {
      query = query.eq('status', status);
    }

    // Execute query
    const { data: sessions, error } = await query;

    if (error) {
      logger.error('Error selecting sessions', { error: error.message });
      return [];
    }

    if (!sessions || sessions.length === 0) {
      logger.info('No sessions found matching criteria', { since, status: status || 'any' });
      return [];
    }

    // Filter by slug (TRUTH GATE - this is the primary filter)
    let filtered = sessions;
    if (slugs.length > 0) {
      filtered = sessions.filter(s => {
        const sessionSlug = s.project_slug || '';
        // Slug must be non-null and match one of the allowed slugs
        if (!sessionSlug) return false;
        return slugs.some(slug => sessionSlug.includes(slug));
      });
    } else {
      // No slugs provided - filter out null/unassigned slugs
      filtered = sessions.filter(s => {
        const sessionSlug = s.project_slug || '';
        return sessionSlug && sessionSlug !== 'unassigned' && sessionSlug !== 'terminal';
      });
    }

    // Apply limit after filtering
    filtered = filtered.slice(0, limit);

    logger.info(`Selected ${filtered.length} sessions for extraction`, {
      total: sessions.length,
      filtered: filtered.length,
      since,
      status: status || 'any',
      slugs: slugs.slice(0, 3)
    });

    return filtered;

  } catch (err) {
    logger.error('Error in selectSessions', { error: err.message });
    return [];
  }
}

module.exports = { selectSessions, parseDuration };
