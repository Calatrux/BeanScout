/**
 * Debug utility to track component loading and identify hangs
 */

const DEBUG_ENABLED = true

export function debugLog(component, message, data = null) {
  if (!DEBUG_ENABLED) return

  const timestamp = new Date().toISOString().split('T')[1].split('.')[0]
  const logMessage = `[${timestamp}] [${component}] ${message}`

  if (data) {
    console.log(logMessage, data)
  } else {
    console.log(logMessage)
  }
}

export function debugTimeStart(component, operation) {
  if (!DEBUG_ENABLED) return

  const key = `${component}-${operation}`
  console.time(`[DEBUG] ${key}`)
  return key
}

export function debugTimeEnd(key) {
  if (!DEBUG_ENABLED) return

  console.timeEnd(`[DEBUG] ${key}`)
}

// Track page load progress
if (typeof window !== 'undefined') {
  window.beanscoutDebug = {
    components: {},
    markLoaded: (component) => {
      window.beanscoutDebug.components[component] = Date.now()
      debugLog('DEBUG', `Component ${component} loaded`)
    },
    getLoadTimes: () => {
      return window.beanscoutDebug.components
    },
    reset: () => {
      window.beanscoutDebug.components = {}
    }
  }
}