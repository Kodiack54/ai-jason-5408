/**
 * Mark session as extracted after successful processing
 * Updates session status and adds extraction metadata
 */

const db = require('../lib/db');
const { Logger } = require('../lib/logger');

const logger = new Logger('Jason:MarkExtracted');

/**
 * Mark a session as extracted
 * @param {string} sessionId - Session UUID
 * @param {Object} metadata - Extraction metadata
 */
async function markExtracted(sessionId, metadata = {}) {
  try {
    const updateData = {
      status: 'extracted',
      extracted_at: new Date().toISOString(),
      extraction_metadata: {
        ...metadata,
        extractor: 'jason-v1',
        timestamp: new Date().toISOString()
      }
    };

    const { error } = await db.from('dev_ai_sessions')
      .update(updateData)
      .eq('id', sessionId);

    if (error) {
      logger.error('Failed to mark session as extracted', {
        sessionId,
        error: error.message
      });
      return false;
    }

    logger.info('Session marked as extracted', {
      sessionId,
      items: metadata.items_created,
      duplicates: metadata.duplicates_skipped
    });

    return true;

  } catch (err) {
    logger.error('Error marking session extracted', {
      sessionId,
      error: err.message
    });
    return false;
  }
}

/**
 * Mark session as extraction failed
 * @param {string} sessionId
 * @param {string} reason
 */
async function markExtractionFailed(sessionId, reason) {
  try {
    const { error } = await db.from('dev_ai_sessions')
      .update({
        extraction_metadata: {
          failed: true,
          reason,
          timestamp: new Date().toISOString()
        }
      })
      .eq('id', sessionId);

    if (error) {
      logger.error('Failed to mark extraction failure', { sessionId });
    }

  } catch (err) {
    logger.error('Error marking extraction failure', { error: err.message });
  }
}

module.exports = { markExtracted, markExtractionFailed };
