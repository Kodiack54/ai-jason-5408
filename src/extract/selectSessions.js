/**
 * Select sessions to process for extraction
 *
 * Selection criteria:
 * 1. Status = 'cleaned' (Susan has cleaned the transcript)
 * 2. Has clean transcript in dev_ai_clean_transcripts
 * 3. Slug must match allowlist (truth gate)
 * 4. Not already extracted
 */

const db = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Jason:SelectSessions');

/**
 * Parse duration string to milliseconds
 * @param {string} duration - e.g., '30m', '1h', '3h', '24h'
 */
function parseDuration(duration) {
  const match = duration.match(/^(\d+)(m|h|d)$/);
  if (!match) return 3 * 60 * 60 * 1000; // Default 3 hours

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
 * @param {string} options.since - Lookback duration (default: 3h)
 * @param {string[]} options.slugs - Allowed project slugs (REQUIRED for filtering)
 * @param {number} options.limit - Max sessions to return
 */
async function selectSessions(options = {}) {
  const {
    sessionId,
    since = '3h',  // Default 3 hour chunks
    slugs = [],
    limit = 20
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

    // Query sessions with status='cleaned' that have clean transcripts
    const { data: sessions, error } = await db.from('dev_ai_sessions')
      .select('*')
      .eq('status', 'cleaned')  // Only cleaned sessions
      .gte('created_at', cutoffTime)
      .order('created_at', { ascending: false })
      .limit(limit * 3);  // Fetch more, filter by slug after

    if (error) {
      logger.error('Error selecting sessions', { error: error.message });
      return [];
    }

    if (!sessions || sessions.length === 0) {
      logger.info('No cleaned sessions found', { since });
      return [];
    }

    // Filter by slug (TRUTH GATE - this is the primary filter)
    let filtered = sessions;
    if (slugs.length > 0) {
      filtered = sessions.filter(s => {
        const sessionSlug = s.project_slug || '';
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

    // Verify each session has a clean transcript
    const validSessions = [];
    for (const session of filtered) {
      const { data: cleanTranscript } = await db.from('dev_ai_clean_transcripts')
        .select('id')
        .eq('session_id', session.id)
        .single();

      if (cleanTranscript) {
        validSessions.push(session);
      }
    }

    // Apply limit after filtering
    const result = validSessions.slice(0, limit);

    logger.info(`Selected ${result.length} sessions for extraction`, {
      total: sessions.length,
      afterSlugFilter: filtered.length,
      withCleanTranscript: result.length,
      since,
      slugs: slugs.slice(0, 3)
    });

    return result;

  } catch (err) {
    logger.error('Error in selectSessions', { error: err.message });
    return [];
  }
}

module.exports = { selectSessions, parseDuration };
