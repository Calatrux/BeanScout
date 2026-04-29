import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env vars not set. Remote sync will be unavailable.')
}

// Supabase v2 uses navigator.locks to coordinate JWT refresh across tabs.
// If a lock is held by a dead tab, new requests hang indefinitely.
// This wrapper aborts after acquireTimeout ms and falls back to running
// the operation without the lock so the app stays responsive.
async function timedLock(name, acquireTimeout, fn) {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return fn()
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), acquireTimeout)
  try {
    return await navigator.locks.request(name, { signal: controller.signal }, fn)
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[Supabase] Lock timed out — running without lock')
      return fn()
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      lock: timedLock,
    },
  }
)
