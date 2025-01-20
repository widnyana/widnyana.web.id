#!/usr/bin/env bash

hugo server \
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
