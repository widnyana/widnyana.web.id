#!/usr/bin/env bash
set -euo pipefail

BIND=127.0.0.1
HOST=127.0.0.1

if [[ "${1:-}" == "--lan" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
  else
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  fi
  : "${LOCAL_IP:=127.0.0.1}" # fall back to loopback if no LAN iface is up
  BIND=0.0.0.0
  HOST="${LOCAL_IP}"
fi

HUGO_BASEURL="http://${HOST}:1313/" \
hugo server \
  --bind "${BIND}" \
  --baseURL "http://${HOST}/" \
  --buildDrafts \
  --buildFuture \
  --disableFastRender \
  --enableGitInfo \
  --gc \
  --ignoreCache \
  --noHTTPCache \
  --poll 1s \
  --templateMetrics \
  --watch \
  --logLevel info
