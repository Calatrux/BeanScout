import { openDB } from 'idb'

const DB_NAME = 'beanscout'
const DB_VERSION = 3
const OPERATION_TIMEOUT = 10000 // 10 seconds timeout for database operations

let dbPromise = null

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

async function getDB() {
  // Return existing promise if already opening
  if (dbPromise) {
    console.log('[IndexedDB] Reusing existing database connection')
    return dbPromise
  }

  console.log('[IndexedDB] Opening database...')
  dbPromise = withTimeout(
    openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        console.log('[IndexedDB] Upgrading from version', oldVersion, 'to', DB_VERSION)
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains('qual_scouting')) {
            console.log('[IndexedDB] Creating qual_scouting store')
            const store = db.createObjectStore('qual_scouting', { keyPath: 'id' })
            store.createIndex('by_synced', 'synced')
            store.createIndex('by_event', 'event_key')
          }
          if (!db.objectStoreNames.contains('team_notes')) {
            console.log('[IndexedDB] Creating team_notes store')
            const store = db.createObjectStore('team_notes', { keyPath: 'id' })
            store.createIndex('by_synced', 'synced')
            store.createIndex('by_team', 'team_number')
          }
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('tba_cache')) {
            console.log('[IndexedDB] Creating tba_cache store')
            db.createObjectStore('tba_cache', { keyPath: 'event_key' })
          }
        }
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains('picklists')) {
            console.log('[IndexedDB] Creating picklists store')
            const store = db.createObjectStore('picklists', { keyPath: 'id' })
            store.createIndex('by_synced', 'synced')
            store.createIndex('by_scouter', 'scouter_name')
            store.createIndex('by_event', 'event_key')
          }
        }
        console.log('[IndexedDB] Upgrade complete')
      },
      blocked() {
        console.warn('[IndexedDB] Database upgrade blocked. Close other tabs or windows.')
        // Reset the promise so next call tries again
        dbPromise = null
      },
      blocking() {
        console.warn('[IndexedDB] This page is blocking a database upgrade. Reloading...')
        // Close the database and reload
        dbPromise.then(db => db.close()).catch(() => {})
        dbPromise = null
        window.location.reload()
      },
      terminated() {
        console.error('[IndexedDB] Database connection terminated unexpectedly')
        dbPromise = null
      },
    }).then(db => {
      console.log('[IndexedDB] Database opened successfully')
      return db
    }).catch(err => {
      console.error('[IndexedDB] Failed to open database:', err)
      dbPromise = null
      throw err
    }),
    OPERATION_TIMEOUT,
    'database initialization'
  ).catch(err => {
    console.error('[IndexedDB] Database initialization failed or timed out:', err)
    dbPromise = null
    throw err
  })

  return dbPromise
}

// Export getDB for use in other modules
export { getDB }

// Debug utility: reset database (call from console if stuck)
if (typeof window !== 'undefined') {
  window.resetBeanScoutDB = async () => {
    console.log('[IndexedDB] Manual reset requested...')
    dbPromise = null
    try {
      const dbs = await window.indexedDB.databases()
      const db = dbs.find(d => d.name === DB_NAME)
      if (db) {
        console.log('[IndexedDB] Deleting database...')
        await new Promise((resolve, reject) => {
          const req = window.indexedDB.deleteDatabase(DB_NAME)
          req.onsuccess = resolve
          req.onerror = reject
          req.onblocked = () => {
            console.warn('[IndexedDB] Delete blocked - close all tabs and try again')
            reject(new Error('Delete blocked'))
          }
        })
        console.log('[IndexedDB] Database deleted. Reload the page.')
      } else {
        console.log('[IndexedDB] No database found to delete.')
      }
    } catch (err) {
      console.error('[IndexedDB] Reset failed:', err)
    }
  }
}

export async function saveQualEntry(entry) {
  console.log('[IndexedDB] Saving qual entry:', entry.id)
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for qual entry save')
  return withTimeout(db.put('qual_scouting', entry), OPERATION_TIMEOUT, 'save qual entry')
}

export async function saveTeamNote(note) {
  console.log('[IndexedDB] Saving team note:', note.id)
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for team note save')
  return withTimeout(db.put('team_notes', note), OPERATION_TIMEOUT, 'save team note')
}

export async function getUnsyncedQualEntries() {
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for unsynced qual entries')
  const allEntries = await withTimeout(db.getAll('qual_scouting'), OPERATION_TIMEOUT, 'get all qual entries')
  return allEntries.filter(entry => !entry.synced)
}

export async function getUnsyncedTeamNotes() {
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for unsynced team notes')
  const allNotes = await withTimeout(db.getAll('team_notes'), OPERATION_TIMEOUT, 'get all team notes')
  return allNotes.filter(note => !note.synced)
}

export async function markQualEntrySynced(id) {
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for mark qual entry synced')
  const entry = await withTimeout(db.get('qual_scouting', id), OPERATION_TIMEOUT, 'get qual entry for sync mark')
  if (entry) await withTimeout(db.put('qual_scouting', { ...entry, synced: true }), OPERATION_TIMEOUT, 'mark qual entry synced')
}

export async function markTeamNoteSynced(id) {
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for mark team note synced')
  const note = await withTimeout(db.get('team_notes', id), OPERATION_TIMEOUT, 'get team note for sync mark')
  if (note) await withTimeout(db.put('team_notes', { ...note, synced: true }), OPERATION_TIMEOUT, 'mark team note synced')
}

export async function getUnsyncedCount() {
  const [qual, notes, picklists] = await Promise.all([
    getUnsyncedQualEntries(),
    getUnsyncedTeamNotes(),
    getUnsyncedPicklists(),
  ])
  return qual.length + notes.length + picklists.length
}

// Picklist functions
export async function savePicklist(picklist) {
  console.log('[IndexedDB] Saving picklist:', picklist.id)
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for picklist save')
  return withTimeout(db.put('picklists', picklist), OPERATION_TIMEOUT, 'save picklist')
}

export async function getPicklist(id) {
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for get picklist')
  return withTimeout(db.get('picklists', id), OPERATION_TIMEOUT, 'get picklist')
}

export async function deletePicklist(id) {
  console.log('[IndexedDB] Deleting picklist:', id)
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for delete picklist')
  return withTimeout(db.delete('picklists', id), OPERATION_TIMEOUT, 'delete picklist')
}

export async function getPicklistsByScouter(scouterName) {
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for get picklists by scouter')
  return withTimeout(db.getAllFromIndex('picklists', 'by_scouter', scouterName), OPERATION_TIMEOUT, 'get picklists by scouter')
}

export async function getPicklistsByEvent(eventKey) {
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for get picklists by event')
  return withTimeout(db.getAllFromIndex('picklists', 'by_event', eventKey), OPERATION_TIMEOUT, 'get picklists by event')
}

export async function getUnsyncedPicklists() {
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for unsynced picklists')
  const allPicklists = await withTimeout(db.getAll('picklists'), OPERATION_TIMEOUT, 'get all picklists')
  return allPicklists.filter(picklist => !picklist.synced)
}

export async function markPicklistSynced(id) {
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for mark picklist synced')
  const picklist = await withTimeout(db.get('picklists', id), OPERATION_TIMEOUT, 'get picklist for sync mark')
  if (picklist) await withTimeout(db.put('picklists', { ...picklist, synced: true }), OPERATION_TIMEOUT, 'mark picklist synced')
}

export async function getAllPicklists() {
  const db = await withTimeout(getDB(), OPERATION_TIMEOUT, 'getDB for get all picklists')
  return withTimeout(db.getAll('picklists'), OPERATION_TIMEOUT, 'get all picklists')
}
