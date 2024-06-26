#!/usr/bin/env bash

hugo server \
  --gc \
  --buildDrafts \
  --buildFuture \
  --disableFastRender \
  --enableGitInfo \
  --ignoreCache \
  --noHTTPCache \
  --watch 
