import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import * as Papa from "papaparse";

/* ─────────── helpers ─────────── */
const getRankColor = (avg) => {
  if (avg <= 1.3) return "#22c55e";
  if (avg <= 1.7) return "#84cc16";
  if (avg <= 2.0) return "#eab308";
  if (avg <= 2.5) return "#f97316";
  return "#ef4444";
};
const getRankLabel = (avg) => {
  if (avg <= 1.3) return "Elite";
  if (avg <= 1.7) return "Strong";
  if (avg <= 2.0) return "Average";
  if (avg <= 2.5) return "Below Avg";
  return "Weak";
};
const getNoShowCount = (notes) => notes.filter((n) => /no\s*show/i.test(n)).length;
const getIncapCount = (notes) => notes.filter((n) => /incap/i.test(n) && !/no\s*show/i.test(n)).length;

const tagKeywords = {
  "Push/Herd": [/push/i, /herd/i, /corral/i, /funnel/i],
  Defense: [/defen[cs]e/i, /defended/i, /blocking/i, /pinned/i],
  Shooter: [/shoot/i, /shot/i, /\bbps\b/i, /accuracy/i],
  "Intake Issues": [/intake.*(broke|issue|jam|terrible|slow|broken|disconnect)/i, /broken.*intake/i],
  "Fast Cycles": [/fast.*cycl/i, /good.*cycl/i, /quick.*cycl/i, /solid.*cycl/i, /decent.*cycl/i],
  Incap: [/\bincap/i],
  "No Show": [/no\s*show/i],
  Climb: [/climb/i],
};
const getTeamTags = (notes) => {
  const tags = new Set();
  notes.forEach((n) =>
    Object.entries(tagKeywords).forEach(([tag, pats]) => {
      if (pats.some((p) => p.test(n))) tags.add(tag);
    })
  );
  return [...tags];
};

const STORAGE_KEY = "frc-scouting-v1";

/* ─────────── main component ─────────── */
export default function ScoutingHub() {
  const [rawEntries, setRawEntries] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (_) {
      return [];
    }
  });
  const [importMsg, setImportMsg] = useState(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("avgRank");
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [filterTag, setFilterTag] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const fileRef = useRef();

  /* ── save to localStorage whenever rawEntries changes ── */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rawEntries));
    } catch (e) {
      console.error("Storage save error:", e);
    }
  }, [rawEntries]);

  /* ── CSV parsing + dedup ── */
  const processCSV = useCallback(
    (text) => {
      const parsed = Papa.parse(text.trim(), { header: false, skipEmptyLines: true });
      const rows = parsed.data.slice(1); // skip header

      const existingKeys = new Set(rawEntries.map((e) => e.ts + "|" + e.team + "|" + e.rank));
      let newCount = 0;
      let dupeCount = 0;
      const newEntries = [];

      rows.forEach((r) => {
        if (r.length < 10) return;
        const ts = (r[0] || "").trim();
        const triples = [
          { team: (r[1] || "").trim(), note: (r[4] || "").trim(), rank: (r[7] || "").trim() },
          { team: (r[2] || "").trim(), note: (r[5] || "").trim(), rank: (r[8] || "").trim() },
          { team: (r[3] || "").trim(), note: (r[6] || "").trim(), rank: (r[9] || "").trim() },
        ];
        triples.forEach(({ team, note, rank }) => {
          if (!team || !/^\d+$/.test(team)) return;
          const key = ts + "|" + team + "|" + rank;
          if (existingKeys.has(key)) {
            dupeCount++;
            return;
          }
          existingKeys.add(key);
          newEntries.push({ ts, team: parseInt(team), note, rank: parseInt(rank) || null });
          newCount++;
        });
      });

      setRawEntries((prev) => [...prev, ...newEntries]);
      setImportMsg({ newCount, dupeCount, total: newCount + dupeCount });
      setTimeout(() => setImportMsg(null), 8000);
    },
    [rawEntries]
  );

  const handleFile = useCallback(
    (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => processCSV(e.target.result);
      reader.readAsText(file);
    },
    [processCSV]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && file.name.endsWith(".csv")) handleFile(file);
    },
    [handleFile]
  );

  const handleReset = () => {
    setRawEntries([]);
    setShowConfirmReset(false);
    setImportMsg({ newCount: 0, dupeCount: 0, total: 0, reset: true });
    setTimeout(() => setImportMsg(null), 4000);
  };

  /* ── aggregate entries into team objects ── */
  const teams = useMemo(() => {
    const map = {};
    rawEntries.forEach(({ team, note, rank }) => {
      if (!map[team]) map[team] = { number: team, notes: [], ranks: [] };
      if (note) map[team].notes.push(note);
      if (rank) map[team].ranks.push(rank);
    });
    return Object.values(map).map((t) => {
      const avg = t.ranks.length
        ? +(t.ranks.reduce((a, b) => a + b, 0) / t.ranks.length).toFixed(2)
        : 99;
      return {
        ...t,
        avgRank: avg,
        numEntries: t.notes.length,
        noShows: getNoShowCount(t.notes),
        incaps: getIncapCount(t.notes),
        tags: getTeamTags(t.notes),
        rankDist: [
          t.ranks.filter((r) => r === 1).length,
          t.ranks.filter((r) => r === 2).length,
          t.ranks.filter((r) => r === 3).length,
        ],
      };
    });
  }, [rawEntries]);

  const sortedTeams = useMemo(() => {
    let f = [...teams];
    if (search) f = f.filter((t) => t.number.toString().includes(search));
    if (filterTag) f = f.filter((t) => t.tags.includes(filterTag));
    if (sortBy === "avgRank") f.sort((a, b) => a.avgRank - b.avgRank);
    else if (sortBy === "team") f.sort((a, b) => a.number - b.number);
    else if (sortBy === "entries") f.sort((a, b) => b.numEntries - a.numEntries);
    else if (sortBy === "noShows") f.sort((a, b) => b.noShows - a.noShows);
    return f;
  }, [teams, search, sortBy, filterTag]);

  const allTags = useMemo(() => {
    const s = new Set();
    teams.forEach((t) => t.tags.forEach((tag) => s.add(tag)));
    return [...s].sort();
  }, [teams]);

  /* ─────────── STYLES ─────────── */
  const S = {
    root: {
      fontFamily: "'JetBrains Mono','Fira Code',monospace",
      background: "#0a0a0f",
      color: "#e2e2e8",
      minHeight: "100vh",
      padding: "24px 16px",
    },
    title: {
      fontFamily: "'Orbitron',sans-serif",
      fontSize: 26,
      fontWeight: 900,
      background: "linear-gradient(135deg,#f97316,#ef4444,#ec4899)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      margin: 0,
      letterSpacing: 2,
    },
    subtitle: { color: "#666", fontSize: 12, marginTop: 6, letterSpacing: 1 },
    input: {
      background: "#14141f",
      border: "1px solid #2a2a3a",
      borderRadius: 8,
      padding: "8px 14px",
      color: "#e2e2e8",
      fontFamily: "inherit",
      fontSize: 13,
      outline: "none",
    },
    card: (isOpen, color) => ({
      background: "#111119",
      border: `1px solid ${isOpen ? color + "66" : "#1e1e2e"}`,
      borderRadius: 12,
      overflow: "hidden",
      transition: "border-color 0.2s",
    }),
    note: (isNoShow, isIncap) => ({
      padding: "10px 14px",
      background: isNoShow ? "#1a0a0a" : isIncap ? "#1a1408" : "#0d0d16",
      border: `1px solid ${isNoShow ? "#3a1515" : isIncap ? "#3a2a10" : "#1a1a28"}`,
      borderRadius: 8,
      fontSize: 12.5,
      lineHeight: 1.55,
      color: isNoShow ? "#ef4444aa" : "#c8c8d4",
      whiteSpace: "pre-wrap",
      borderLeft: `3px solid ${isNoShow ? "#ef4444" : isIncap ? "#f97316" : "#2a2a3a"}`,
    }),
  };

  return (
    <div style={S.root}>
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Orbitron:wght@500;700;900&display=swap"
        rel="stylesheet"
      />

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <h1 style={S.title}>SUBJECTIVE SCOUTING</h1>
        <p style={S.subtitle}>
          {teams.length} TEAMS &middot; {rawEntries.length} TOTAL ENTRIES
          {rawEntries.length > 0 && <> &middot; PERSISTENT</>}
        </p>
      </div>

      {/* ── Upload Zone ── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#f97316" : "#2a2a3a"}`,
          borderRadius: 12,
          padding: "20px 16px",
          textAlign: "center",
          cursor: "pointer",
          marginBottom: 16,
          background: dragOver ? "#f9731610" : "#0d0d16",
          transition: "all 0.2s",
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <div style={{ fontSize: 22, marginBottom: 6 }}>{dragOver ? "\u2B07" : "\uD83D\uDCC2"}</div>
        <div style={{ fontSize: 13, color: "#888" }}>
          Drop a CSV here or{" "}
          <span style={{ color: "#f97316", textDecoration: "underline" }}>click to upload</span>
        </div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
          Duplicates are automatically detected &amp; skipped
        </div>
      </div>

      {/* Import toast */}
      {importMsg && (
        <div
          style={{
            background: importMsg.reset ? "#1a0a0a" : "#0a1a0a",
            border: `1px solid ${importMsg.reset ? "#3a1515" : "#1a3a15"}`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 12,
            display: "flex",
            gap: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {importMsg.reset ? (
            <span style={{ color: "#ef4444" }}>All data cleared.</span>
          ) : (
            <>
              <span style={{ color: "#22c55e", fontWeight: 600 }}>+{importMsg.newCount} new</span>
              <span style={{ color: "#666" }}>{importMsg.dupeCount} duplicates skipped</span>
              <span style={{ color: "#555" }}>{importMsg.total} rows processed</span>
            </>
          )}
        </div>
      )}

      {/* Controls */}
      {teams.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
              alignItems: "center",
            }}
          >
            <input
              type="text"
              placeholder="Search team #..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...S.input, width: 150 }}
            />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={S.input}>
              <option value="avgRank">Sort: Best Rank</option>
              <option value="team">Sort: Team #</option>
              <option value="entries">Sort: Most Notes</option>
              <option value="noShows">Sort: Most No-Shows</option>
            </select>
            <div style={{ marginLeft: "auto" }}>
              {!showConfirmReset ? (
                <button
                  onClick={() => setShowConfirmReset(true)}
                  style={{
                    background: "transparent",
                    border: "1px solid #2a2a3a",
                    borderRadius: 8,
                    padding: "8px 14px",
                    color: "#555",
                    fontFamily: "inherit",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Reset All Data
                </button>
              ) : (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ color: "#ef4444", fontSize: 11 }}>Sure?</span>
                  <button
                    onClick={handleReset}
                    style={{
                      background: "#ef444422",
                      border: "1px solid #ef4444",
                      borderRadius: 6,
                      padding: "6px 12px",
                      color: "#ef4444",
                      fontFamily: "inherit",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Yes, wipe it
                  </button>
                  <button
                    onClick={() => setShowConfirmReset(false)}
                    style={{
                      background: "transparent",
                      border: "1px solid #2a2a3a",
                      borderRadius: 6,
                      padding: "6px 12px",
                      color: "#888",
                      fontFamily: "inherit",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Tag Filters */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                style={{
                  background: filterTag === tag ? "#f97316" : "#1a1a28",
                  color: filterTag === tag ? "#000" : "#888",
                  border: `1px solid ${filterTag === tag ? "#f97316" : "#2a2a3a"}`,
                  borderRadius: 20,
                  padding: "4px 12px",
                  fontSize: 11,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {tag}
              </button>
            ))}
            {filterTag && (
              <button
                onClick={() => setFilterTag(null)}
                style={{
                  background: "transparent",
                  color: "#ef4444",
                  border: "1px solid #ef4444",
                  borderRadius: 20,
                  padding: "4px 12px",
                  fontSize: 11,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                \u2715 Clear
              </button>
            )}
          </div>

          {/* Team Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sortedTeams.map((team) => {
              const isOpen = expandedTeam === team.number;
              const color = getRankColor(team.avgRank);
              return (
                <div key={team.number} style={S.card(isOpen, color)}>
                  <div
                    onClick={() => setExpandedTeam(isOpen ? null : team.number)}
                    style={{
                      padding: "14px 18px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Orbitron',sans-serif",
                        fontSize: 20,
                        fontWeight: 700,
                        color: "#fff",
                        minWidth: 70,
                      }}
                    >
                      {team.number}
                    </span>
                    <span
                      style={{
                        background: color + "22",
                        color,
                        border: `1px solid ${color}44`,
                        borderRadius: 6,
                        padding: "3px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {team.avgRank.toFixed(2)} avg &middot; {getRankLabel(team.avgRank)}
                    </span>
                    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                      {["#22c55e", "#eab308", "#ef4444"].map((c, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 3,
                            fontSize: 11,
                            color: c,
                          }}
                        >
                          <div
                            style={{
                              width: Math.max(4, team.rankDist[i] * 6),
                              height: 12,
                              background: c,
                              borderRadius: 2,
                              opacity: 0.7,
                            }}
                          />
                          <span style={{ opacity: 0.7 }}>{team.rankDist[i]}</span>
                        </div>
                      ))}
                    </div>
                    <div
                      style={{
                        marginLeft: "auto",
                        display: "flex",
                        gap: 12,
                        fontSize: 11,
                        color: "#666",
                        flexShrink: 0,
                      }}
                    >
                      <span>{team.numEntries} notes</span>
                      {team.noShows > 0 && (
                        <span style={{ color: "#ef4444" }}>{team.noShows} no-show</span>
                      )}
                      {team.incaps > 0 && (
                        <span style={{ color: "#f97316" }}>{team.incaps} incap</span>
                      )}
                    </div>
                    <span style={{ color: "#444", fontSize: 16, flexShrink: 0 }}>
                      {isOpen ? "\u25B2" : "\u25BC"}
                    </span>
                  </div>

                  {!isOpen && (
                    <div
                      style={{ padding: "0 18px 10px", display: "flex", gap: 5, flexWrap: "wrap" }}
                    >
                      {team.tags
                        .filter((t) => t !== "No Show" && t !== "Incap")
                        .map((tag) => (
                          <span
                            key={tag}
                            style={{
                              background: "#1a1a28",
                              color: "#888",
                              borderRadius: 4,
                              padding: "2px 8px",
                              fontSize: 10,
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                    </div>
                  )}

                  {isOpen && (
                    <div style={{ padding: "0 18px 18px" }}>
                      <div
                        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}
                      >
                        {team.tags.map((tag) => (
                          <span
                            key={tag}
                            style={{
                              background: "#1a1a28",
                              color: "#aaa",
                              border: "1px solid #2a2a3a",
                              borderRadius: 6,
                              padding: "3px 10px",
                              fontSize: 11,
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {team.notes.map((note, i) => {
                          const isNS = /no\s*show/i.test(note);
                          const isInc = /incap/i.test(note);
                          return (
                            <div key={i} style={S.note(isNS, isInc)}>
                              {note}
                            </div>
                          );
                        })}
                      </div>
                      <div
                        style={{
                          marginTop: 14,
                          padding: "10px 14px",
                          background: "#0d0d16",
                          border: "1px solid #1a1a28",
                          borderRadius: 8,
                          fontSize: 12,
                          color: "#888",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "#aaa" }}>Rank History: </span>
                        {team.ranks.map((r, i) => (
                          <span
                            key={i}
                            style={{
                              color: r === 1 ? "#22c55e" : r === 2 ? "#eab308" : "#ef4444",
                              fontWeight: 600,
                            }}
                          >
                            {r}
                            {i < team.ranks.length - 1 ? "  " : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {sortedTeams.length === 0 && (
            <div style={{ textAlign: "center", color: "#444", padding: 40, fontSize: 14 }}>
              No teams match your search.
            </div>
          )}
        </>
      )}

      {teams.length === 0 && !importMsg && (
        <div style={{ textAlign: "center", color: "#444", padding: 40, fontSize: 14 }}>
          No data yet. Upload your first CSV above to get started.
        </div>
      )}
    </div>
  );
}
