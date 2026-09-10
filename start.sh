#!/bin/bash
# ES modules require http://, not file:// — serve the folder and open it.
cd "$(dirname "$0")"
PORT=${1:-877}
echo "Shop Tech Simulator → http://localhost:$PORT"
open "http://localhost:$PORT" 2>/dev/null &
exec python3 -m http.server "$PORT"
