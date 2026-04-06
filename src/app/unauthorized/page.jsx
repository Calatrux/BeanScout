import Link from 'next/link'

export const metadata = {
  title: 'Unauthorized | BEAN Scout',
}

export default function UnauthorizedPage() {
  return (
    <div className="auth-container">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <h1 className="auth-title">Access Denied</h1>
        <p className="auth-subtitle">
          You don&apos;t have permission to access this page.
          Contact an administrator if you believe this is an error.
        </p>
        <Link href="/" className="submit-btn" style={{ display: 'block', marginTop: '24px' }}>
          Go Home
        </Link>
      </div>
    </div>
  )
}
