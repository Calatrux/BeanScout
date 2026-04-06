import Link from 'next/link'
import Image from 'next/image'

export default function HomePage() {
  return (
    <div className="page">
      <div className="home-hero">
        <Image
          src="/logo.png"
          alt="BEAN 1833"
          width={180}
          height={60}
          className="home-logo"
          priority
        />
        <h1 className="home-title">BEAN Scout</h1>
        <p className="home-subtitle">Qualitative FRC scouting, built for the field</p>
      </div>

      <div className="home-cards">
        <Link href="/qual-scout" className="home-card">
          <div className="home-card-title">Qual Match</div>
          <div className="home-card-desc">
            Rank the 3 teams on an alliance 1 to 3 with written justification for each.
          </div>
        </Link>

        <Link href="/team-notes" className="home-card">
          <div className="home-card-title">Team Note</div>
          <div className="home-card-desc">
            Record a specific observation about any team, optionally tied to a match.
          </div>
        </Link>
      </div>
    </div>
  )
}
