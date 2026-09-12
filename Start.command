#!/bin/bash
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  python3 start.py
elif command -v node >/dev/null 2>&1; then
  (sleep 1; open http://localhost:8787) &
  node server.cjs
else
  echo "This launcher needs Python 3 or Node.js. Neither was found."
  echo "The source files and README.md are in this folder."
  read -r -p "Press Enter to close…"
fi
