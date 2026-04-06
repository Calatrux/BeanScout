import { getDB } from './indexeddb'

const STORE_NAME = 'tba_cache'
const CACHE_TIMEOUT = 10000 // 10 second timeout for cache operations (increased for first load)

/**
 * Timeout wrapper for async operations
 */
function withTimeout(promise, timeoutMs, operation) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ])
}

/**
 * Get cached event data
 */
export async function getCachedEventData(eventKey) {
  try {
    console.log('[TBA Cache] Getting DB handle...')
    const db = await withTimeout(getDB(), CACHE_TIMEOUT, 'getDB')
    console.log('[TBA Cache] Got DB handle, fetching cache for:', eventKey)
    const cached = await withTimeout(db.get(STORE_NAME, eventKey), CACHE_TIMEOUT, 'cache read')
    if (cached) {
      console.log('[TBA Cache] Cache hit for:', eventKey, cached)
    } else {
      console.log('[TBA Cache] Cache miss for:', eventKey)
    }
    return cached || null
  } catch (err) {
    console.error('[TBA Cache] Error reading cache:', err)
    return null
  }
}

/**
 * Cache event data (info, matches, teams)
 */
export async function cacheEventData(eventKey, info, matches, teams) {
  try {
    console.log('[TBA Cache] Caching event:', eventKey)
    const db = await withTimeout(getDB(), CACHE_TIMEOUT, 'getDB for cache write')
    await withTimeout(
      db.put(STORE_NAME, {
        event_key: eventKey,
        info,
        matches,
        teams,
        cached_at: new Date().toISOString(),
      }),
      CACHE_TIMEOUT,
      'cache write'
    )
    console.log('[TBA Cache] Successfully cached event:', eventKey)
  } catch (err) {
    console.error('[TBA Cache] Error writing cache:', err)
  }
}

/**
 * Get cached teams for an event
 */
export async function getCachedTeams(eventKey) {
  const cached = await getCachedEventData(eventKey)
  return cached?.teams || null
}

/**
 * Clear cache for an event (if needed to refresh)
 */
export async function clearEventCache(eventKey) {
  try {
    console.log('[TBA Cache] Clearing cache for:', eventKey)
    const db = await withTimeout(getDB(), CACHE_TIMEOUT, 'getDB for cache clear')
    await withTimeout(db.delete(STORE_NAME, eventKey), CACHE_TIMEOUT, 'cache delete')
    console.log('[TBA Cache] Cleared cache for:', eventKey)
  } catch (err) {
    console.error('[TBA Cache] Error clearing cache:', err)
  }
}
