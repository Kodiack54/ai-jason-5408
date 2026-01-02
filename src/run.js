#!/usr/bin/env node
/**
 * Jason - Guardrailed Extraction Scheduler
 *
 * Commands:
 *   extract --scheduled              Run scheduled extraction (every 30 min)
 *   extract --session=<id>           Extract from specific session
 *   extract --since=30m --slugs=...  Extract recent sessions matching slugs
 *   extract --dry-run                Show what would be extracted without inserting
 */

const { program } = require('commander');
const { Logger } = require('./lib/logger');
const { startHealthServer } = require('./lib/healthServer');
const { selectSessions } = require('./extract/selectSessions');
const { loadTranscript } = require('./extract/loadTranscript');
const { extractItems } = require('./extract/extractItems');
const { validateItems } = require('./extract/validateItems');
const { insertStaging } = require('./extract/insertStaging');
const { markExtracted } = require('./extract/markExtracted');

const logger = new Logger('Jason:CLI');

// Runtime status for health endpoint
const runtimeStatus = {
  startedAt: new Date().toISOString(),
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  totalRuns: 0,
  totalItemsExtracted: 0
};

// Start health server if port configured
const healthPort = process.env.JASON_HEALTH_PORT ? Number(process.env.JASON_HEALTH_PORT) : null;
if (healthPort) {
  startHealthServer({
    port: healthPort,
    getStatus: () => runtimeStatus
  });
}

// Allowed slugs for extraction (real project slugs only - no terminal/unassigned)
const ALLOWED_SLUGS = [
  'ai-chad',
  'ai-jen',
  'ai-susan',
  'ai-clair',
  'ai-jason',
  'dev-studio',
  'kodiack-dashboard',
  'kodiack-studio',
  'nextbid',
  'premier-group'
];

program
  .name('jason')
  .description('Guardrailed Extraction Scheduler')
  .version('1.0.0');

program
  .command('extract')
  .description('Extract todos/bugs/worklogs/decisions from sessions')
  .option('--scheduled', 'Run in scheduled mode (default 30m lookback)')
  .option('--session <id>', 'Extract from specific session ID')
  .option('--since <duration>', 'Lookback duration (e.g., 30m, 1h, 24h)', '3h')
  .option('--slugs <list>', 'Comma-separated slug filter', ALLOWED_SLUGS.join(','))
  .option('--dry-run', 'Show what would be extracted without inserting')
  .option('--limit <n>', 'Max sessions to process', '10')
  .action(async (options) => {
    const startTime = Date.now();
    const stats = {
      sessions_scanned: 0,
      sessions_processed: 0,
      todos: 0,
      bugs: 0,
      worklogs: 0,
      decisions: 0,
      duplicates: 0,
      errors: 0
    };

    try {
      logger.info('Starting extraction run', {
        mode: options.scheduled ? 'scheduled' : 'manual',
        since: options.since,
        dryRun: !!options.dryRun
      });

      // Parse slugs
      const slugs = options.slugs.split(',').map(s => s.trim()).filter(Boolean);
      const validSlugs = slugs.filter(s => ALLOWED_SLUGS.some(allowed => s.startsWith(allowed)));

      if (validSlugs.length === 0) {
        logger.error('No valid slugs provided', { provided: slugs, allowed: ALLOWED_SLUGS });
        process.exit(1);
      }

      // Select sessions to process
      let sessions;
      if (options.session) {
        sessions = await selectSessions({ sessionId: options.session });
      } else {
        sessions = await selectSessions({
          since: options.since,
          slugs: validSlugs,
          limit: parseInt(options.limit, 10),
          status: 'cleaned'  // Pull from Jen-processed sessions
        });
      }

      stats.sessions_scanned = sessions.length;
      logger.info(`Found ${sessions.length} sessions to process`);

      if (sessions.length === 0) {
        updateRuntimeStatus(stats, startTime, options.dryRun, null);
        printRunReport(stats, startTime, options.dryRun);
        return;
      }

      // Process each session
      for (const session of sessions) {
        try {
          logger.info(`Processing session: ${session.id}`, {
            slug: session.project_slug,
            created: session.created_at
          });

          // Load transcript content
          const transcript = await loadTranscript(session.id);
          if (!transcript || !transcript.content) {
            logger.warn(`No transcript content for session ${session.id}`);
            continue;
          }

          // Extract items (todos, bugs, worklogs, decisions)
          const items = await extractItems(transcript, session);

          // Validate items against schemas
          const { valid, invalid } = validateItems(items);

          if (invalid.length > 0) {
            logger.warn(`${invalid.length} items failed validation`, {
              sessionId: session.id,
              reasons: invalid.slice(0, 3).map(i => i.error)
            });
          }

          if (valid.length === 0) {
            logger.info(`No valid items extracted from session ${session.id}`);
            continue;
          }

          // Count by type
          valid.forEach(item => {
            if (item.bucket === 'Todos') stats.todos++;
            else if (item.bucket === 'Bugs Open' || item.bucket === 'Bugs Fixed') stats.bugs++;
            else if (item.bucket === 'Work Log') stats.worklogs++;
            else if (item.bucket === 'Decisions') stats.decisions++;
          });

          if (options.dryRun) {
            // Dry run - just print what would be inserted
            logger.info(`[DRY RUN] Would insert ${valid.length} items:`, {
              todos: valid.filter(i => i.bucket === 'Todos').length,
              bugs: valid.filter(i => i.bucket.includes('Bug')).length,
              worklogs: valid.filter(i => i.bucket === 'Work Log').length,
              decisions: valid.filter(i => i.bucket === 'Decisions').length
            });

            // Print sample items
            valid.slice(0, 3).forEach(item => {
              console.log(`  [${item.bucket}] ${item.title?.substring(0, 60) || item.content?.substring(0, 60)}...`);
            });
          } else {
            // Insert into staging table
            const { inserted, duplicates } = await insertStaging(valid, session.id, session.project_slug);
            stats.duplicates += duplicates;

            // Mark session as extracted
            await markExtracted(session.id, {
              extraction_version: '1.0.0',
              items_created: inserted,
              duplicates_skipped: duplicates
            });

            runtimeStatus.totalItemsExtracted += inserted;
          }

          stats.sessions_processed++;

        } catch (err) {
          logger.error(`Error processing session ${session.id}`, { error: err.message });
          stats.errors++;
        }
      }

      updateRuntimeStatus(stats, startTime, options.dryRun, null);
      printRunReport(stats, startTime, options.dryRun);

    } catch (err) {
      logger.error('Extraction run failed', { error: err.message, stack: err.stack });
      stats.errors++;
      updateRuntimeStatus(stats, startTime, options.dryRun, err);
      printRunReport(stats, startTime, options.dryRun);
      process.exit(1);
    }
  });

function updateRuntimeStatus(stats, startTime, dryRun, error) {
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  runtimeStatus.lastRunAt = new Date().toISOString();
  runtimeStatus.totalRuns++;
  runtimeStatus.lastResult = {
    status: stats.errors === 0 ? 'RUN_OK' : 'RUN_PARTIAL',
    dryRun,
    duration: `${duration}s`,
    ...stats
  };
  runtimeStatus.lastError = error ? String(error.message || error) : null;
}

function printRunReport(stats, startTime, dryRun) {
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const status = stats.errors === 0 ? 'RUN_OK' : 'RUN_PARTIAL';

  const report = [
    '',
    '═══════════════════════════════════════════════════════════',
    `  EXTRACTION ${dryRun ? '(DRY RUN) ' : ''}COMPLETE - ${status}`,
    '═══════════════════════════════════════════════════════════',
    `  sessions_scanned=${stats.sessions_scanned}`,
    `  sessions_processed=${stats.sessions_processed}`,
    `  todos=${stats.todos}`,
    `  bugs=${stats.bugs}`,
    `  worklogs=${stats.worklogs}`,
    `  decisions=${stats.decisions}`,
    `  duplicates=${stats.duplicates}`,
    `  errors=${stats.errors}`,
    `  duration=${duration}s`,
    '═══════════════════════════════════════════════════════════',
    ''
  ].join('\n');

  console.log(report);

  // Also log structured version
  logger.info(`${status} sessions_scanned=${stats.sessions_scanned} sessions_processed=${stats.sessions_processed} todos=${stats.todos} bugs=${stats.bugs} worklogs=${stats.worklogs} decisions=${stats.decisions} duplicates=${stats.duplicates}`);
}

program.parse();
