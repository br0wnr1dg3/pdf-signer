#!/bin/bash
# Double-click me. Starts a local server (localhost only) and opens the app.
cd "$(dirname "$0")" || exit 1
PORT=8765
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required. Install Xcode Command Line Tools: xcode-select --install"; read -r; exit 1
fi
if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  disown
  for _ in $(seq 1 20); do lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && break; sleep 0.1; done
fi
open "http://localhost:$PORT/"
