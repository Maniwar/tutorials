#!/usr/bin/env bash
# install.sh — put the demo-video skill on this machine so Claude Code can use it
# in EVERY project, not just the repo it lives in.
#
# Two ways to run it:
#   • From a repo checkout:   bash .claude/skills/demo-video/install.sh
#   • Straight from GitHub:   curl -fsSL \
#       https://raw.githubusercontent.com/maniwar/tutorials/master/.claude/skills/demo-video/install.sh | bash
#
# It copies the skill into ~/.claude/skills/demo-video (override with
# DEST=/path or --dest /path) and reports which optional tools are present.
set -euo pipefail

DEST="${DEST:-$HOME/.claude/skills/demo-video}"
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

FILES=(
  SKILL.md README.md install.sh
  scripts/cursor.js scripts/record.js scripts/titlecard.js scripts/tts.py scripts/assemble.py
  references/recipe.md references/gotchas.md
)
RAW_BASE="https://raw.githubusercontent.com/maniwar/tutorials/master/.claude/skills/demo-video"

# Where are the source files? Next to this script (repo checkout) or fetch them.
SRC=""
SELF="${BASH_SOURCE[0]:-}"
if [ -n "$SELF" ] && [ -f "$(dirname "$SELF")/SKILL.md" ]; then
  SRC="$(cd "$(dirname "$SELF")" && pwd)"
fi

echo "Installing demo-video skill → $DEST"
mkdir -p "$DEST/scripts" "$DEST/references"

for rel in "${FILES[@]}"; do
  mkdir -p "$DEST/$(dirname "$rel")"
  if [ -n "$SRC" ] && [ -f "$SRC/$rel" ]; then
    cp "$SRC/$rel" "$DEST/$rel"
  else
    echo "  fetching $rel"
    curl -fsSL "$RAW_BASE/$rel" -o "$DEST/$rel"
  fi
done
chmod +x "$DEST/install.sh" "$DEST/scripts/assemble.py" "$DEST/scripts/tts.py" 2>/dev/null || true

echo "✓ installed. Claude Code will discover it in any project on this machine."
echo
echo "Optional tools (the skill guides you if one is missing):"
check() { if command -v "$1" >/dev/null 2>&1; then echo "  ✓ $1"; else echo "  · $1   ($2)"; fi; }
check node   "needed to record — install Node.js"
check ffmpeg "needed to assemble — apt-get install -y ffmpeg / brew install ffmpeg"
check espeak-ng "TIMING PREVIEW ONLY — never publish this voice (apt-get install -y espeak-ng)"
if python3 -c "import edge_tts" >/dev/null 2>&1; then
  echo "  ✓ edge-tts   (free human neural voice — the recommended narrator)"
else
  echo "  · edge-tts   (RECOMMENDED for voiceover: pip install edge-tts — free, no API key)"
fi
if node -e "require('playwright-core')" >/dev/null 2>&1 || node -e "require('playwright')" >/dev/null 2>&1; then
  echo "  ✓ playwright"
else
  echo "  · playwright   (npm i -g playwright-core, or in your recording dir)"
fi
echo
echo "Voiceover: 'pip install edge-tts' gives a free, genuinely human narrator with no"
echo "     API key. OPENAI_API_KEY / ELEVENLABS_API_KEY give more control. espeak is"
echo "     for hearing your timing back while editing — never for a published cut."
