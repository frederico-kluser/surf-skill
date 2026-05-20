#!/usr/bin/env bash
# Multi-agent installer for the surf skill (multi-provider web connector:
# Tavily + Parallel AI).
#
# Re-runnable. Configures Pi, OpenCode, Claude Code, Codex CLI, and GitHub
# Copilot CLI to discover ~/.agents/skills/surf/ via native paths and
# defensive symlinks.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELL_NAME="$(basename "${SHELL:-bash}")"
SHELL_RC="${HOME}/.${SHELL_NAME}rc"

echo "🛠  Installing surf skill from $SKILL_DIR"

# 1) Node 18+ check
command -v node >/dev/null || { echo "❌ Node 18+ required"; exit 1; }
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 18 ] || { echo "❌ Need Node ≥18 (have $NODE_MAJOR)"; exit 1; }

# 2) Make CLI executable
chmod +x "$SKILL_DIR/bin/surf.mjs"

# 3) PATH symlink + ensure ~/.local/bin is on PATH
mkdir -p "$HOME/.local/bin"
ln -sf "$SKILL_DIR/bin/surf.mjs" "$HOME/.local/bin/surf"
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
  ln -snf "$SKILL_DIR" "$dir/surf"
done

# 4b) Remove the legacy 'tavily' symlinks from a previous install (if present).
for legacy in \
  "$HOME/.agents/skills/tavily" \
  "$HOME/.claude/skills/tavily" \
  "$HOME/.codex/skills/tavily" \
  "$HOME/.pi/agent/skills/tavily" \
  "$HOME/.local/bin/tvly"
do
  if [ -L "$legacy" ]; then
    rm -f "$legacy"
    echo "✓ removed legacy symlink $legacy"
  fi
done

# 5) State directory + initial keys.json (chmod 600)
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
  if ! node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('$KEYS_FILE','utf8'));process.exit(s.tavily.keys.length>0?1:0)"; then
    :
  else
    "$SKILL_DIR/bin/surf.mjs" keys add --provider tavily "$TAVILY_API_KEY" >/dev/null && \
      { echo "✓ imported TAVILY_API_KEY into $KEYS_FILE"; seeded=1; }
  fi
fi
if [ -n "${PARALLEL_API_KEY:-}" ]; then
  if node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('$KEYS_FILE','utf8'));process.exit(s.parallel.keys.length>0?1:0)"; then
    "$SKILL_DIR/bin/surf.mjs" keys add --provider parallel "$PARALLEL_API_KEY" >/dev/null && \
      { echo "✓ imported PARALLEL_API_KEY into $KEYS_FILE"; seeded=1; }
  fi
fi
if [ "$seeded" = "1" ]; then
  echo "  Note: surf no longer reads env vars at runtime. You can remove TAVILY_API_KEY / PARALLEL_API_KEY from your shell rc."
fi

# 7) OpenCode experimental timeouts (defense in depth)
OC_CFG="$HOME/.config/opencode/opencode.json"
mkdir -p "$(dirname "$OC_CFG")"
[ -f "$OC_CFG" ] || echo '{}' > "$OC_CFG"
node -e '
const fs=require("fs"), p=process.argv[1];
let c={}; try{c=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}
c["$schema"]=c["$schema"]||"https://opencode.ai/config.json";
c.experimental=Object.assign({},c.experimental,{mcp_timeout:600000});
c.experimental.bash=Object.assign({},c.experimental.bash,{timeout_ms:600000});
fs.writeFileSync(p,JSON.stringify(c,null,2));
console.log("✓ wrote",p);
' "$OC_CFG"

# 8) Permanent bash-tool default timeout
if ! grep -q 'OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS' "$SHELL_RC" 2>/dev/null; then
  cat >> "$SHELL_RC" <<'EOF'

# surf-skill: expand OpenCode bash tool default timeout to 10 min
export OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS=600000
EOF
  echo "✓ added OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS to $SHELL_RC"
fi

# 9) Smoke test
echo "🔎 Smoke test…"
"$SKILL_DIR/bin/surf.mjs" --version >/dev/null
"$SKILL_DIR/bin/surf.mjs" keys list >/dev/null
echo "✓ surf --version and 'surf keys list' work"

HAS_TAVILY=$(node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('$KEYS_FILE','utf8'));console.log(s.tavily.keys.length>0?'yes':'no')")
HAS_PARALLEL=$(node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('$KEYS_FILE','utf8'));console.log(s.parallel.keys.length>0?'yes':'no')")

if [ "$HAS_TAVILY" = "yes" ] || [ "$HAS_PARALLEL" = "yes" ]; then
  echo "🔎 Live smoke test (1 search)…"
  if "$SKILL_DIR/bin/surf.mjs" search "surf hello world" --max 1 >/dev/null 2>&1; then
    echo "✓ live search works"
  else
    echo "⚠ live search failed — check keys/network with: surf keys list"
  fi
fi

echo
if [ "$HAS_TAVILY" = "no" ]; then
  echo "ℹ Add a Tavily key:   surf keys add --provider tavily tvly-..."
  echo "                      Get one at https://app.tavily.com"
fi
if [ "$HAS_PARALLEL" = "no" ]; then
  echo "ℹ Add a Parallel key: surf keys add --provider parallel <key>"
  echo "                      Get one at https://platform.parallel.ai"
fi

echo
echo "✅ Done. Restart your shell, then:"
echo "   pi              → ask 'search the web for X'"
echo "   opencode        → same"
echo "   claude          → same"
echo "   copilot         → /skills info surf   then ask 'search the web for X'"
