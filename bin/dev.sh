#!/usr/bin/env bash
set -euo pipefail

LOCAL_IP=$(hostname -I | awk '{print $1}')

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
