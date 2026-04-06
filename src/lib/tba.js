/**
 * The Blue Alliance API utility
 */

const TBA_BASE_URL = 'https://www.thebluealliance.com/api/v3'

/**
 * Fetch data from TBA API
 */
async function fetchTBA(endpoint) {
  const apiKey = process.env.NEXT_PUBLIC_TBA_API_KEY
  if (!apiKey) {
    console.error('[TBA] API key not configured')
    throw new Error('TBA API key not configured')
  }

  console.log('[TBA] Fetching:', endpoint)
  const response = await fetch(`${TBA_BASE_URL}${endpoint}`, {
    headers: {
      'X-TBA-Auth-Key': apiKey,
    },
  })

  if (!response.ok) {
    console.error('[TBA] API error:', response.status, response.statusText)
    throw new Error(`TBA API error: ${response.status}`)
  }

  const data = await response.json()
  console.log('[TBA] Success:', endpoint, data)
  return data
}

/**
 * Get all matches for an event (quals only by default)
 * Returns matches sorted by match number
 */
export async function getEventMatches(eventKey, qualsOnly = true) {
  const matches = await fetchTBA(`/event/${eventKey}/matches/simple`)

  let filtered = matches
  if (qualsOnly) {
    filtered = matches.filter(m => m.comp_level === 'qm')
  }

  // Sort by match number
  filtered.sort((a, b) => a.match_number - b.match_number)

  return filtered.map(match => ({
    key: match.key,
    matchNumber: match.match_number,
    compLevel: match.comp_level,
    red: match.alliances.red.team_keys.map(k => parseInt(k.replace('frc', ''), 10)),
    blue: match.alliances.blue.team_keys.map(k => parseInt(k.replace('frc', ''), 10)),
  }))
}

/**
 * Get teams at an event
 */
export async function getEventTeams(eventKey) {
  const teams = await fetchTBA(`/event/${eventKey}/teams/simple`)

  return teams.map(team => ({
    number: team.team_number,
    name: team.nickname,
    city: team.city,
    stateProv: team.state_prov,
  })).sort((a, b) => a.number - b.number)
}

/**
 * Get event info
 */
export async function getEventInfo(eventKey) {
  const event = await fetchTBA(`/event/${eventKey}`)

  return {
    key: event.key,
    name: event.name,
    shortName: event.short_name,
    city: event.city,
    stateProv: event.state_prov,
    startDate: event.start_date,
    endDate: event.end_date,
  }
}
