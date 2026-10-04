#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "Node.js 22 or newer is required: https://nodejs.org" >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  echo "Node $(node -v) is too old. Seal Forge needs Node 22 or newer." >&2
  exit 1
fi

echo "Installing Seal Forge files..."
npm install
chmod +x "$root/installer/start.sh"

case "$(uname -s)" in
  Darwin)
    osascript -e "tell application \"Finder\" to make alias file to posix file \"$root/installer/start.sh\" at posix file \"$HOME/Desktop\"" >/dev/null 2>&1 || true
    ;;
  Linux)
    cat > "$HOME/Desktop/Seal Forge.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Seal Forge
Exec=$root/installer/start.sh
Path=$root
Terminal=true
EOF
    chmod +x "$HOME/Desktop/Seal Forge.desktop" || true
    ;;
esac

echo "Installed. Starting the table at http://127.0.0.1:8080"
exec "$root/installer/start.sh"
