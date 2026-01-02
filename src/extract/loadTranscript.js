/**
 * Load transcript content for a session
 * Fetches clean_text from dev_ai_clean_transcripts (NOT raw_content)
 */

const db = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Jason:LoadTranscript');

/**
 * Load CLEAN transcript content for a session
 * @param {string} sessionId - Session UUID
 * @returns {Object} { content, metadata }
 */
async function loadTranscript(sessionId) {
  try {
    // Get clean_text from dev_ai_clean_transcripts
    const { data: cleanTranscript, error } = await db.from('dev_ai_clean_transcripts')
      .select('clean_text, file_refs, project_id')
      .eq('session_id', sessionId)
      .single();

    if (error || !cleanTranscript) {
      logger.warn('No clean transcript found for session', { sessionId, error: error?.message });
      return null;
    }

    if (!cleanTranscript.clean_text) {
      logger.warn('Empty clean_text for session', { sessionId });
      return null;
    }

    // Also get session metadata
    const { data: session } = await db.from('dev_ai_sessions')
      .select('summary, project_slug')
      .eq('id', sessionId)
      .single();

    logger.info('Loaded clean transcript', {
      sessionId,
      contentLength: cleanTranscript.clean_text.length,
      fileRefs: cleanTranscript.file_refs?.length || 0,
      slug: session?.project_slug
    });

    return {
      content: cleanTranscript.clean_text,
      metadata: {
        source: 'dev_ai_clean_transcripts',
        summary: session?.summary,
        slug: session?.project_slug,
        fileRefs: cleanTranscript.file_refs
      }
    };

  } catch (err) {
    logger.error('Error loading transcript', { sessionId, error: err.message });
    return null;
  }
}

/**
 * Format transcript for extraction prompt
 * Cleans ANSI codes, normalizes whitespace
 */
function formatTranscript(content) {
  if (!content) return '';

  // Remove ANSI escape codes
  let cleaned = content.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

  // Remove other escape sequences
  cleaned = cleaned.replace(/\x1B\][^\x07]*\x07/g, '');

  // Normalize multiple newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Trim lines
  cleaned = cleaned.split('\n').map(l => l.trimEnd()).join('\n');

  return cleaned.trim();
}

module.exports = { loadTranscript, formatTranscript };
