// Agent platform tables (plan section 3.1, docs/agent-platform/CONTRACTS.md). Names are final:
// owners may add columns (addColumn) but never rename. Run by lib/schema/index.js from db.js.

// One row per existing workflow, seeded as a built-in agent. `slug` is what members @mention;
// `workflow` is the name the dispatcher and agent_runs use.
const BUILTINS = [
  ["filing_flash", "Filing flash", "Reads each new 8-K, 10-Q and 10-K on a holding and writes a short cited flash.", "file"],
  ["earnings_flash", "Earnings flash", "Writes a cited flash when a holding reports earnings (8-K item 2.02).", "chart"],
  ["red_team", "Red team", "Argues the other side of a pitch when it opens for a vote.", "shield"],
  ["earnings_preview", "Earnings preview", "Previews what to watch in the week before a holding reports.", "calendar"],
  ["weekly_memo", "Weekly memo", "Friday memo of the week's verified agent output and fund moves; an editor approves it.", "memo"],
  ["macro_brief", "Macro brief", "Monday brief on rates, inflation, the curve and rate-sensitive holdings.", "globe"],
  ["ownership_watch", "Ownership watch", "Wednesday check of insiders, short interest and 13F breadth across holdings.", "users"],
  ["policy_watch", "Policy watch", "Thursday check of Congress trades and federal contracts in holdings.", "building"],
  ["data_qa", "Data QA", "Nightly code-only check of SEC figures against Yahoo for debt, cash, shares and FCF.", "check"],
  ["thesis_check", "Thesis check", "After a flash on a holding with a written thesis, proposes a thesis status.", "target"],
  ["ask_pif", "Ask PIF", "Answers members' questions with the app's own data and sources.", "chat"],
  ["pitch_primer", "Pitch primer", "Drafts a primer for a new pitch.", "lightbulb"],
  ["compare", "Compare", "Compares several companies side by side.", "columns"],
  ["what_if", "What if", "Shows how proposed trades would change the fund.", "sliders"],
  ["meeting_prep", "Meeting prep", "Prepares a brief for the next fund meeting.", "clipboard"],
  ["ideas", "Ideas", "Suggests new ideas to research.", "sparkles"],
];
const slugOf = (workflow) => workflow.replace(/_/g, "-");

module.exports = function applyPlatform(db, { addColumn }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT 'bot',
      kind TEXT NOT NULL CHECK (kind IN ('builtin','custom')),
      workflow TEXT,
      ownerId INTEGER REFERENCES members(id) ON DELETE SET NULL,
      visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('private','team')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived','suspended')),
      spec TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      forkedFrom INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      lastRunAt TEXT,
      nextRunAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS agents_workflow ON agents (workflow);
    CREATE INDEX IF NOT EXISTS agents_owner ON agents (ownerId, status);
    CREATE INDEX IF NOT EXISTS agents_next_run ON agents (status, nextRunAt);

    CREATE TABLE IF NOT EXISTS agent_versions (
      agentId INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      spec TEXT NOT NULL,
      editedBy INTEGER REFERENCES members(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agentId, version)
    );

    CREATE TABLE IF NOT EXISTS agent_follows (
      agentId INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      memberId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      notify TEXT NOT NULL DEFAULT 'inbox',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agentId, memberId)
    );
    CREATE INDEX IF NOT EXISTS agent_follows_member ON agent_follows (memberId);

    CREATE TABLE IF NOT EXISTS feed_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      actorType TEXT NOT NULL CHECK (actorType IN ('member','agent','system')),
      actorId INTEGER,
      agentId INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      runId INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      symbol TEXT,
      pitchId INTEGER,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '{}',
      visibility TEXT NOT NULL DEFAULT 'team',
      importance TEXT NOT NULL DEFAULT 'normal' CHECK (importance IN ('high','normal','low')),
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS feed_items_created ON feed_items (createdAt, id);
    CREATE INDEX IF NOT EXISTS feed_items_symbol ON feed_items (symbol, createdAt);
    CREATE INDEX IF NOT EXISTS feed_items_agent ON feed_items (agentId, createdAt);

    CREATE TABLE IF NOT EXISTS feed_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      itemId INTEGER NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
      memberId INTEGER REFERENCES members(id) ON DELETE SET NULL,
      agentId INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      runId INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS feed_comments_item ON feed_comments (itemId, id);

    CREATE TABLE IF NOT EXISTS feed_reactions (
      itemId INTEGER NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
      memberId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (itemId, memberId, emoji)
    );

    CREATE TABLE IF NOT EXISTS agent_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK (scope IN ('fund','symbol','agent','member')),
      scopeKey TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('fact','observation','decision','preference','open_question','prediction')),
      text TEXT NOT NULL,
      sourceRunId INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      sourceUrl TEXT,
      asOf TEXT,
      confidence REAL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('proposed','active','superseded','retracted')),
      supersedesId INTEGER REFERENCES agent_memory(id) ON DELETE SET NULL,
      createdByAgent INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      createdByMember INTEGER REFERENCES members(id) ON DELETE SET NULL,
      expiresAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS agent_memory_scope ON agent_memory (scope, scopeKey, status);
    CREATE INDEX IF NOT EXISTS agent_memory_agent ON agent_memory (createdByAgent, createdAt);

    CREATE TABLE IF NOT EXISTS agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fromAgentId INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      fromRunId INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      toAgentId INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      topic TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('handoff','finding','request','answer')),
      symbol TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','done','dropped')),
      claimedByRunId INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS agent_messages_topic ON agent_messages (topic, status);
    CREATE INDEX IF NOT EXISTS agent_messages_to ON agent_messages (toAgentId, status);
    CREATE INDEX IF NOT EXISTS agent_messages_symbol ON agent_messages (symbol, createdAt);

    CREATE TABLE IF NOT EXISTS thesis_pillars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      pitchId INTEGER,
      ord INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      kpi TEXT,
      status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('intact','watch','weakened','broken','unknown')),
      createdBy INTEGER REFERENCES members(id) ON DELETE SET NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      retiredAt TEXT
    );
    CREATE INDEX IF NOT EXISTS thesis_pillars_symbol ON thesis_pillars (symbol, retiredAt, ord);

    CREATE TABLE IF NOT EXISTS thesis_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      pillarId INTEGER REFERENCES thesis_pillars(id) ON DELETE CASCADE,
      runId INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('intact','watch','weakened','broken','unknown')),
      score REAL,
      evidence TEXT NOT NULL DEFAULT '[]',
      method TEXT NOT NULL CHECK (method IN ('rule','ai','member')),
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS thesis_checks_symbol ON thesis_checks (symbol, createdAt);
    CREATE INDEX IF NOT EXISTS thesis_checks_pillar ON thesis_checks (pillarId, createdAt);

    CREATE TABLE IF NOT EXISTS thesis_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      targetPrice REAL,
      editedBy INTEGER REFERENCES members(id) ON DELETE SET NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS thesis_versions_symbol ON thesis_versions (symbol, createdAt);

    CREATE TABLE IF NOT EXISTS scenario_marks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      runId INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
      bullProb REAL,
      baseProb REAL,
      bearProb REAL,
      note TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS scenario_marks_symbol ON scenario_marks (symbol, createdAt);
  `);

  // agent_runs gains the platform columns. `trigger` is an SQLite keyword but works unquoted
  // as a column name; quoting it ("trigger") is also fine.
  addColumn("agent_runs", "agentId", "INTEGER REFERENCES agents(id) ON DELETE SET NULL");
  addColumn("agent_runs", "parentRunId", "INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL");
  addColumn("agent_runs", "trigger", "TEXT");
  addColumn("agent_runs", "triggeredBy", "INTEGER REFERENCES members(id) ON DELETE SET NULL");
  addColumn("agent_runs", "shared", "INTEGER NOT NULL DEFAULT 0");
  addColumn("agent_runs", "summary", "TEXT");
  db.exec(`CREATE INDEX IF NOT EXISTS agent_runs_agent ON agent_runs (agentId, createdAt)`);
  db.exec(`CREATE INDEX IF NOT EXISTS agent_runs_parent ON agent_runs (parentRunId)`);

  // Built-in agents, one per existing workflow (INSERT OR IGNORE keeps member edits to them).
  const ins = db.prepare(`INSERT OR IGNORE INTO agents (slug, name, description, icon, kind, workflow, visibility, spec)
    VALUES (?, ?, ?, ?, 'builtin', ?, 'team', '{"v":1}')`);
  for (const [workflow, name, description, icon] of BUILTINS) ins.run(slugOf(workflow), name, description, icon, workflow);
  // Back-fill: older runs get the agent of their workflow.
  db.exec(`UPDATE agent_runs SET agentId = (SELECT a.id FROM agents a WHERE a.kind = 'builtin' AND a.workflow = agent_runs.workflow)
    WHERE agentId IS NULL AND workflow IN (SELECT workflow FROM agents WHERE kind = 'builtin')`);
};

module.exports.BUILTINS = BUILTINS;
module.exports.slugOf = slugOf;
