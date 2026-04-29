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

-- Prescouting: per-match robot performance tracking
CREATE TABLE prescouting (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_key TEXT NOT NULL,
  team_number INT NOT NULL,
  match_number TEXT NOT NULL,
  scouter_name TEXT NOT NULL,
  -- Auton
  auto_start_position TEXT,
  auto_end_position TEXT,
  auto_10_cycles INT NOT NULL DEFAULT 0,
  auto_20_cycles INT NOT NULL DEFAULT 0,
  auto_35_cycles INT NOT NULL DEFAULT 0,
  auto_40_cycles INT NOT NULL DEFAULT 0,
  auto_50_cycles INT NOT NULL DEFAULT 0,
  auto_60_cycles INT NOT NULL DEFAULT 0,
  auto_climb_level INT,
  auto_climb_time TIMESTAMPTZ,
  -- Teleop
  teleop_10_cycles INT NOT NULL DEFAULT 0,
  teleop_20_cycles INT NOT NULL DEFAULT 0,
  teleop_35_cycles INT NOT NULL DEFAULT 0,
  teleop_40_cycles INT NOT NULL DEFAULT 0,
  teleop_50_cycles INT NOT NULL DEFAULT 0,
  teleop_60_cycles INT NOT NULL DEFAULT 0,
  -- Passing
  pass_10_cycles INT NOT NULL DEFAULT 0,
  pass_20_cycles INT NOT NULL DEFAULT 0,
  pass_35_cycles INT NOT NULL DEFAULT 0,
  pass_40_cycles INT NOT NULL DEFAULT 0,
  pass_50_cycles INT NOT NULL DEFAULT 0,
  pass_60_cycles INT NOT NULL DEFAULT 0,
  total_pass_time REAL NOT NULL DEFAULT 0,
  -- Misc
  trench_count INT NOT NULL DEFAULT 0,
  bump_count INT NOT NULL DEFAULT 0,
  endgame_climb_level INT,
  endgame_climb_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prescouting_event ON prescouting (event_key, team_number);
CREATE INDEX idx_prescouting_match ON prescouting (event_key, match_number);

-- Alliance column (run if table already exists)
ALTER TABLE prescouting ADD COLUMN IF NOT EXISTS alliance TEXT CHECK (alliance IN ('red', 'blue'));

-- Skill rankings for qual_scouting (1=best, 3=worst, relative within alliance)
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team1_agility_rank SMALLINT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team2_agility_rank SMALLINT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team3_agility_rank SMALLINT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team1_field_awareness_rank SMALLINT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team2_field_awareness_rank SMALLINT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team3_field_awareness_rank SMALLINT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team1_driver_ability_rank SMALLINT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team2_driver_ability_rank SMALLINT;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team3_driver_ability_rank SMALLINT;

-- Defense tracking for team_notes
ALTER TABLE team_notes ADD COLUMN IF NOT EXISTS played_defense BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE team_notes ADD COLUMN IF NOT EXISTS defense_effectiveness TEXT CHECK (defense_effectiveness IN ('minimal', 'decent', 'impactful', 'shutdown'));

-- Starred teams (notable/flagged for attention)
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team1_starred BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team2_starred BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE qual_scouting ADD COLUMN IF NOT EXISTS team3_starred BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE team_notes ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT FALSE;

-- RLS for prescouting
ALTER TABLE prescouting ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can insert prescouting"
  ON prescouting FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can read prescouting"
  ON prescouting FOR SELECT TO authenticated USING (true);

-- Prescouting team assignments (admin assigns teams to scouts)
CREATE TABLE prescouting_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_key TEXT NOT NULL,
  team_number INT NOT NULL,
  assigned_to TEXT NOT NULL,  -- scout username
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_key, team_number)
);

CREATE INDEX idx_prescouting_assignments_event ON prescouting_assignments (event_key);
CREATE INDEX idx_prescouting_assignments_scout ON prescouting_assignments (event_key, assigned_to);

ALTER TABLE prescouting_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read assignments"
  ON prescouting_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage assignments"
  ON prescouting_assignments FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Allow admins to read all profiles (needed for scout assignment dropdown)
-- Run only if this policy doesn't already exist on your profiles table:
CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );
