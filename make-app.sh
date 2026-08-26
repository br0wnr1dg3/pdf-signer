#!/bin/bash
# Builds "PDF Signer.app" (a tiny AppleScript wrapper around open.command),
# installs it in ~/Applications and puts an alias on the Desktop.
# Drag the app to the Dock to pin it. Re-run after moving this folder.
set -e
cd "$(dirname "$0")"
HERE="$(pwd)"
APP_DIR="$HOME/Applications"
APP="$APP_DIR/PDF Signer.app"
mkdir -p "$APP_DIR"
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script \"/bin/bash \" & quoted form of \"$HERE/open.command\""
# Give it an icon: reuse the system PDF document icon if available.
ICON=/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericDocumentIcon.icns
[ -f "$ICON" ] && cp "$ICON" "$APP/Contents/Resources/applet.icns"
# Desktop alias (Finder alias, so it survives Dock/Applications moves).
osascript -e "tell application \"Finder\" to make alias file to (POSIX file \"$APP\") at (path to desktop folder)" >/dev/null 2>&1 || true
echo "Installed: $APP"
echo "Desktop alias created. Drag the app onto the Dock to pin it."
