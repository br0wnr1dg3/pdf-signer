#!/bin/bash
# Double-click me. Starts a local server and opens the app.
cd "$(dirname "$0")"
PORT=8765
if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  python3 -m http.server $PORT >/dev/null 2>&1 &
  sleep 0.5
fi
open "http://localhost:$PORT/"
