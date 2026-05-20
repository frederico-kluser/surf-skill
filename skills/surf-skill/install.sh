#!/usr/bin/env bash
# Multi-agent installer for the surf-skill (multi-provider web connector:
# Tavily + Parallel AI).
#
# Re-runnable. Configures Pi, OpenCode, Claude Code, Codex CLI, and GitHub
# Copilot CLI to discover ~/.agents/skills/surf-skill/ via native paths and
# defensive symlinks.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELL_NAME="$(basename "${SHELL:-bash}")"
SHELL_RC="${HOME}/.${SHELL_NAME}rc"

echo "🛠  Installing surf-skill from $SKILL_DIR"

# 1) Node 18+ check
command -v node >/dev/null || { echo "❌ Node 18+ required"; exit 1; }
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 18 ] || { echo "❌ Need Node ≥18 (have $NODE_MAJOR)"; exit 1; }

# 2) Make CLI executable
chmod +x "$SKILL_DIR/bin/surf-skill.mjs"

# 3) PATH symlink + ensure ~/.local/bin is on PATH
mkdir -p "$HOME/.local/bin"
ln -sf "$SKILL_DIR/bin/surf-skill.mjs" "$HOME/.local/bin/surf-skill"
if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$SHELL_RC" 2>/dev/null; then
  cat >> "$SHELL_RC" <<'EOF'

# surf-skill: ensure local user binaries are available
export PATH="$HOME/.local/bin:$PATH"
EOF
  echo "✓ added ~/.local/bin to PATH in $SHELL_RC"
fi

# 4) Compatibility symlinks — minimum set needed for full coverage.
#
#    OpenCode reads ~/.agents/skills/ + ~/.claude/skills/ + ~/.config/opencode/skills/
#    GH Copilot CLI reads ~/.copilot/skills/ OR ~/.agents/skills/
#    Claude Code reads ONLY ~/.claude/skills/
#    Codex CLI reads ONLY ~/.codex/skills/
#    Pi reads ONLY ~/.pi/agent/skills/
for dir in \
  "$HOME/.agents/skills"     `# Canonical: OpenCode + GH Copilot CLI` \
  "$HOME/.claude/skills"     `# Anthropic Claude Code` \
  "$HOME/.codex/skills"      `# OpenAI Codex CLI` \
  "$HOME/.pi/agent/skills"   `# Pi Coding Agent`
do
  mkdir -p "$dir"
  ln -snf "$SKILL_DIR" "$dir/surf-skill"
done

# 4b) Remove legacy symlinks from prior installs ('tavily' and short 'surf').
for legacy in \
  "$HOME/.agents/skills/tavily" \
  "$HOME/.claude/skills/tavily" \
  "$HOME/.codex/skills/tavily" \
  "$HOME/.pi/agent/skills/tavily" \
  "$HOME/.agents/skills/surf" \
  "$HOME/.claude/skills/surf" \
  "$HOME/.codex/skills/surf" \
  "$HOME/.pi/agent/skills/surf" \
  "$HOME/.local/bin/tvly" \
  "$HOME/.local/bin/surf"
do
  if [ -L "$legacy" ]; then
    rm -f "$legacy"
    echo "✓ removed legacy symlink $legacy"
  fi
done

# 5) State directory + initial keys.json (chmod 600). We intentionally keep
#    the internal dir as ~/.config/surf/ (short name) so existing state is
#    preserved across the rename.
mkdir -p "$HOME/.config/surf"
KEYS_FILE="$HOME/.config/surf/keys.json"
if [ ! -f "$KEYS_FILE" ]; then
  cat > "$KEYS_FILE" <<'EOF'
{
  "schema_version": 1,
  "tavily":   { "keys": [], "current": 0, "burned": [] },
  "parallel": { "keys": [], "current": 0, "burned": [] },
  "last_ok_provider": null
}
EOF
  chmod 600 "$KEYS_FILE"
  echo "✓ created $KEYS_FILE (chmod 600)"
fi

# 6) Seed legacy keys from env vars on first install.
seeded=0
if [ -n "${TAVILY_API_KEY:-}" ]; then
  if node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('$KEYS_FILE','utf8'));process.exit(s.tavily.keys.length>0?1:0)"; then
    "$SKILL_DIR/bin/surf-skill.mjs" keys add --provider tavily "$TAVILY_API_KEY" >/dev/null && \
      { echo "✓ imported TAVILY_API_KEY into $KEYS_FILE"; seeded=1; }
  fi
fi
if [ -n "${PARALLEL_API_KEY:-}" ]; then
  if node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('$KEYS_FILE','utf8'));process.exit(s.parallel.keys.length>0?1:0)"; then
    "$SKILL_DIR/bin/surf-skill.mjs" keys add --provider parallel "$PARALLEL_API_KEY" >/dev/null && \
      { echo "✓ imported PARALLEL_API_KEY into $KEYS_FILE"; seeded=1; }
  fi
fi
if [ "$seeded" = "1" ]; then
  echo "  Note: surf-skill no longer reads env vars at runtime. You can remove TAVILY_API_KEY / PARALLEL_API_KEY from your shell rc."
fi

# 7) Per-harness timeout settings (defense in depth).
#    All operations below merge non-destructively via Node.

merge_json() {
  local file="$1"
  local patch="$2"
  mkdir -p "$(dirname "$file")"
  [ -f "$file" ] || echo '{}' > "$file"
  node -e '
const fs=require("fs"); const [f,p]=process.argv.slice(1);
let cur={}; try{cur=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}
const patch=JSON.parse(p);
function deepMerge(a,b){ for(const k in b){
  if (b[k] && typeof b[k]==="object" && !Array.isArray(b[k])) {
    a[k] = deepMerge(a[k]||{}, b[k]);
  } else { a[k]=b[k]; }
}; return a; }
deepMerge(cur, patch);
fs.writeFileSync(f, JSON.stringify(cur,null,2)+"\n");
' "$file" "$patch"
}

# 7a) Claude Code — default bash timeout is 2 minutes (max 10).
#     We raise default to 5 min so surf-skill crawl/research-mini fits comfortably.
merge_json "$HOME/.claude/settings.json" '{
  "env": {
    "BASH_DEFAULT_TIMEOUT_MS": "300000",
    "BASH_MAX_TIMEOUT_MS": "600000"
  }
}'
echo "✓ wrote $HOME/.claude/settings.json (BASH_DEFAULT_TIMEOUT_MS=300000)"

# 7b) Pi Coding Agent — default 120s; raise to 300s.
merge_json "$HOME/.pi/agent/settings.json" '{
  "env": {
    "PI_BASH_DEFAULT_TIMEOUT_SECONDS": "300",
    "PI_BASH_MAX_TIMEOUT_SECONDS": "600"
  }
}'
echo "✓ wrote $HOME/.pi/agent/settings.json (PI_BASH_DEFAULT_TIMEOUT_SECONDS=300)"

# 7c) OpenCode — bash + mcp timeouts
merge_json "$HOME/.config/opencode/opencode.json" '{
  "$schema": "https://opencode.ai/config.json",
  "experimental": { "mcp_timeout": 600000, "bash": { "timeout_ms": 600000 } }
}'
echo "✓ wrote $HOME/.config/opencode/opencode.json (bash.timeout_ms=600000)"

# 7d) GH Copilot CLI — no global env var; recommend per-project hooks file.
echo "ℹ GitHub Copilot CLI: default bash timeout is 30s (the most fragile of the three)."
echo "  In each project where you use Copilot CLI + surf-skill, create:"
echo "    .github/copilot-hooks.json"
echo '      { "timeoutSec": 300 }'
echo "  Without this, surf-skill commands beyond 'search --max 1' will time out."

# 8) Permanent bash-tool default timeout for OpenCode (via env)
if ! grep -q 'OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS' "$SHELL_RC" 2>/dev/null; then
  cat >> "$SHELL_RC" <<'EOF'

# surf-skill: expand OpenCode bash tool default timeout to 10 min
export OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS=600000
EOF
  echo "✓ added OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS to $SHELL_RC"
fi

# 9) Smoke test
echo "🔎 Smoke test…"
"$SKILL_DIR/bin/surf-skill.mjs" --version >/dev/null
"$SKILL_DIR/bin/surf-skill.mjs" keys list >/dev/null
echo "✓ surf-skill --version and 'surf-skill keys list' work"

HAS_TAVILY=$(node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('$KEYS_FILE','utf8'));console.log(s.tavily.keys.length>0?'yes':'no')")
HAS_PARALLEL=$(node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('$KEYS_FILE','utf8'));console.log(s.parallel.keys.length>0?'yes':'no')")

if [ "$HAS_TAVILY" = "yes" ] || [ "$HAS_PARALLEL" = "yes" ]; then
  echo "🔎 Live smoke test (1 search)…"
  if "$SKILL_DIR/bin/surf-skill.mjs" search "surf-skill hello world" --max 1 >/dev/null 2>&1; then
    echo "✓ live search works"
  else
    echo "⚠ live search failed — check keys/network with: surf-skill keys list"
  fi
fi

echo
if [ "$HAS_TAVILY" = "no" ] && [ "$HAS_PARALLEL" = "no" ]; then
  echo "ℹ No keys yet. Run an interactive setup:"
  echo "    surf-skill setup"
  echo "  Or add a key directly:"
  echo "    surf-skill keys add --provider tavily tvly-..."
  echo "    surf-skill keys add --provider parallel <key>"
  echo "  Get keys:"
  echo "    Tavily:   https://app.tavily.com  (1,000 free credits/mo)"
  echo "    Parallel: https://platform.parallel.ai"
elif [ "$HAS_TAVILY" = "no" ]; then
  echo "ℹ Add a Tavily key:   surf-skill keys add --provider tavily tvly-..."
  echo "                      Get one at https://app.tavily.com"
elif [ "$HAS_PARALLEL" = "no" ]; then
  echo "ℹ Add a Parallel key: surf-skill keys add --provider parallel <key>"
  echo "                      Get one at https://platform.parallel.ai"
fi

echo
echo "✅ Done. Restart your shell, then:"
echo "   pi              → ask 'search the web for X'"
echo "   opencode        → same"
echo "   claude          → same"
echo "   copilot         → /skills info surf-skill   then ask 'search the web for X'"
