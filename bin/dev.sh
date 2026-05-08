#!/usr/bin/env bash
set -euo pipefail

LOCAL_IP=$(hostname -I | awk '{print $1}')

hugo server \
  --bind 0.0.0.0 \
  --baseURL "http://${LOCAL_IP}:1313/" \
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
  --logLevel debug
