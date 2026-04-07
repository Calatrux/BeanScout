-- BeanScout v1 Schema
-- Run this in your Supabase SQL editor

-- Qual match scouting entries
-- Teams are stored in ranked order: team1 = rank 1 (best), team3 = rank 3 (worst)
CREATE TABLE qual_scouting (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_key TEXT NOT NULL,
  match_number INT NOT NULL,
  alliance TEXT NOT NULL CHECK (alliance IN ('red', 'blue')),
  team1_number INT NOT NULL,
  team1_notes TEXT NOT NULL DEFAULT '',
  team2_number INT NOT NULL,
  team2_notes TEXT NOT NULL DEFAULT '',
  team3_number INT NOT NULL,
  team3_notes TEXT NOT NULL DEFAULT '',
  team1_path JSONB NOT NULL DEFAULT '[]',
  team1_crosses_midline BOOLEAN NOT NULL DEFAULT FALSE,
  team2_path JSONB NOT NULL DEFAULT '[]',
  team2_crosses_midline BOOLEAN NOT NULL DEFAULT FALSE,
  team3_path JSONB NOT NULL DEFAULT '[]',
  team3_crosses_midline BOOLEAN NOT NULL DEFAULT FALSE,
  scouter_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- General team notes
CREATE TABLE team_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_key TEXT NOT NULL,
  team_number INT NOT NULL,
  match_number INT,           -- optional, null if not match-specific
  note TEXT NOT NULL,
  is_update BOOLEAN NOT NULL DEFAULT FALSE,  -- true = update/revision, weight more heavily
  scouter_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
-- Run these ALTERs to add path columns to an existing qual_scouting table:
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team1_path JSONB NOT NULL DEFAULT '[]';
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team1_crosses_midline BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team1_starting_position INT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team1_end_location TEXT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team2_path JSONB NOT NULL DEFAULT '[]';
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team2_crosses_midline BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team2_starting_position INT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team2_end_location TEXT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team3_path JSONB NOT NULL DEFAULT '[]';
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team3_crosses_midline BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team3_starting_position INT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team3_end_location TEXT;

CREATE INDEX idx_qual_scouting_event ON qual_scouting (event_key, match_number);
CREATE INDEX idx_team_notes_team ON team_notes (event_key, team_number);
CREATE INDEX idx_team_notes_update ON team_notes (event_key, is_update);
