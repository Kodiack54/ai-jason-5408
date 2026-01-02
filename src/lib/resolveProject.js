/**
 * Resolve project_slug to project UUID
 * Uses partial matching since session slugs may not exactly match project slugs
 */

const db = require('./db');
const { Logger } = require('./logger');

const logger = new Logger('Jason:ResolveProject');

// Cache to avoid repeated lookups
let projectCache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadProjects() {
  const now = Date.now();
  if (projectCache && (now - cacheTime) < CACHE_TTL) {
    return projectCache;
  }

  const { data, error } = await db.from('dev_projects')
    .select('id, slug, name');
  
  if (error) {
    logger.error('Failed to load projects', { error: error.message });
    return [];
  }

  projectCache = data || [];
  cacheTime = now;
  return projectCache;
}

/**
 * Resolve a session's project_slug to a project UUID
 * @param {string} slug - The project_slug from session
 * @returns {string|null} - Project UUID or null if not found
 */
async function resolveProjectId(slug) {
  if (!slug || slug === 'null' || slug === 'terminal' || slug === 'unassigned') {
    return null;
  }

  const projects = await loadProjects();
  
  // Try exact match first
  let match = projects.find(p => p.slug === slug);
  if (match) return match.id;

  // Try partial match (slug starts with or contains)
  match = projects.find(p => p.slug && p.slug.startsWith(slug + '-'));
  if (match) return match.id;

  // Try contains match
  match = projects.find(p => p.slug && p.slug.includes(slug));
  if (match) return match.id;

  logger.warn('Could not resolve project slug', { slug });
  return null;
}

module.exports = { resolveProjectId };
