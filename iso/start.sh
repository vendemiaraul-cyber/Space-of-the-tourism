#!/usr/bin/env bash
# Boots the Chromium ISO server inside the sandbox VM unless it is already up.
# Called by /api/vm on every boot; ACCESS_KEY arrives in the environment.
cd /vercel/iso || exit 1
health() { curl -fsS -m 2 http://127.0.0.1:3000/healthz >/dev/null 2>&1; }
if health; then echo ALREADY_RUNNING; exit 0; fi
# BrowserHub comes unchanged from github.com/vendemiaraul-cyber/3d-browser (src/core.js), pinned by commit.
CORE_SHA=3d66f1415e6c8e2876a5528fb9922de67bcbd38e
if [ ! -s core.js ] || ! grep -q "export class BrowserHub" core.js; then
  curl -fsSL "https://raw.githubusercontent.com/vendemiaraul-cyber/3d-browser/$CORE_SHA/src/core.js" -o core.js.tmp && mv core.js.tmp core.js
fi
# core.js and server.mjs are ES modules
grep -q '"type": *"module"' package.json 2>/dev/null || npm pkg set type=module >/dev/null 2>&1
CHROMIUM_PATH="$(ls -d /vercel/iso/browsers/chromium/*/chrome-linux*/chrome 2>/dev/null | head -1)"
if [ ! -x "$CHROMIUM_PATH" ]; then
  CHROMIUM_PATH="$(ls -d /vercel/iso/browsers/chrome-headless-shell/*/*/chrome-headless-shell 2>/dev/null | head -1)"
fi
export CHROMIUM_PATH PORT=3000 HOST=0.0.0.0
setsid nohup node /vercel/iso/server.mjs > /tmp/iso-server.log 2>&1 < /dev/null &
for _ in $(seq 1 60); do
  sleep 0.5
  if health; then echo "STARTED $CHROMIUM_PATH"; exit 0; fi
done
echo FAILED
tail -30 /tmp/iso-server.log
exit 1
