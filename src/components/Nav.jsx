'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import SyncBanner from './SyncBanner'

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, loading, signOut } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const dropdownRef = useRef(null)
  const mobileMenuRef = useRef(null)

  const isAuthPage = pathname === '/login' || pathname === '/signup'

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target) &&
          !e.target.closest('.mobile-menu-button')) {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  const handleSignOut = async () => {
    setDropdownOpen(false)
    setMobileMenuOpen(false)
    await signOut()
    router.push('/login')
  }

  const fullName = profile
    ? `${profile.first_name} ${profile.last_name}`.trim() || profile.username
    : ''

  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <Link href="/" className="nav-logo">
            <Image
              src="/logo.png"
              alt="BEAN 1833"
              width={100}
              height={32}
              className="nav-logo-img"
              priority
            />
            <span className="nav-logo-text">Scout</span>
          </Link>

          {/* Desktop nav links */}
          <div className="nav-links desktop-only">
            {user && (profile?.is_scouter || profile?.is_admin) && (
              <>
                <Link
                  href="/qual-scout"
                  className={`nav-link${pathname === '/qual-scout' ? ' active' : ''}`}
                >
                  Qual Match
                </Link>
                <Link
                  href="/team-notes"
                  className={`nav-link${pathname === '/team-notes' ? ' active' : ''}`}
                >
                  Team Notes
                </Link>
                <Link
                  href="/picklist"
                  className={`nav-link${pathname === '/picklist' ? ' active' : ''}`}
                >
                  Picklist
                </Link>
              </>
            )}

            {user && profile?.is_admin && (
              <Link
                href="/admin"
                className={`nav-link${pathname === '/admin' ? ' active' : ''}`}
              >
                Analysis
              </Link>
            )}

            {!loading && (
              <>
                {user ? (
                  <div className="user-dropdown" ref={dropdownRef}>
                    <button
                      className="user-dropdown-trigger"
                      onClick={() => setDropdownOpen(!dropdownOpen)}
                    >
                      <span className="user-name">{fullName}</span>
                      <svg
                        className={`dropdown-arrow${dropdownOpen ? ' open' : ''}`}
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                      >
                        <path d="M6 8L1 3h10z" />
                      </svg>
                    </button>
                    {dropdownOpen && (
                      <div className="user-dropdown-menu">
                        <div className="user-dropdown-info">
                          <span className="user-dropdown-name">{fullName}</span>
                          <span className="user-dropdown-username">@{profile?.username}</span>
                        </div>
                        <div className="user-dropdown-divider" />
                        <button
                          className="user-dropdown-item"
                          onClick={handleSignOut}
                        >
                          Sign Out
                        </button>
                      </div>
                    )}
                  </div>
                ) : !isAuthPage && (
                  <Link href="/login" className="nav-link">
                    Sign In
                  </Link>
                )}
              </>
            )}
          </div>

          {/* Mobile hamburger button */}
          <button
            className="mobile-menu-button mobile-only"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Menu"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {mobileMenuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="mobile-menu mobile-only" ref={mobileMenuRef}>
            {user && (profile?.is_scouter || profile?.is_admin) && (
              <>
                <Link
                  href="/qual-scout"
                  className={`mobile-menu-link${pathname === '/qual-scout' ? ' active' : ''}`}
                >
                  Qual Match
                </Link>
                <Link
                  href="/team-notes"
                  className={`mobile-menu-link${pathname === '/team-notes' ? ' active' : ''}`}
                >
                  Team Notes
                </Link>
                <Link
                  href="/picklist"
                  className={`mobile-menu-link${pathname === '/picklist' ? ' active' : ''}`}
                >
                  Picklist
                </Link>
              </>
            )}

            {user && profile?.is_admin && (
              <Link
                href="/admin"
                className={`mobile-menu-link${pathname === '/admin' ? ' active' : ''}`}
              >
                Analysis
              </Link>
            )}

            {!loading && user && (
              <>
                <div className="mobile-menu-divider" />
                <div className="mobile-menu-user">
                  <span className="mobile-menu-user-name">{fullName}</span>
                  <span className="mobile-menu-user-username">@{profile?.username}</span>
                </div>
                <button
                  className="mobile-menu-link"
                  onClick={handleSignOut}
                >
                  Sign Out
                </button>
              </>
            )}

            {!loading && !user && !isAuthPage && (
              <Link href="/login" className="mobile-menu-link">
                Sign In
              </Link>
            )}
          </div>
        )}
      </nav>
      {user && <SyncBanner />}
    </>
  )
}
