#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" == "Darwin" ]]; then
  LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
else
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
fi
: "${LOCAL_IP:=127.0.0.1}" # fall back to loopback if no LAN iface is up

HUGO_BASEURL="http://${LOCAL_IP}:1313/" \
hugo server \
  --bind 0.0.0.0 \
  --baseURL "http://${LOCAL_IP}/" \
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
