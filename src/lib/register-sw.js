export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      console.log('[SW] Registered:', registration.scope)

      // Check for updates every 60 seconds
      setInterval(() => registration.update(), 60 * 1000)
    } catch (err) {
      console.error('[SW] Registration failed:', err)
    }
  })
}
