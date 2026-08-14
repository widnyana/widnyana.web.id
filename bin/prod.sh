#!/usr/bin/env bash
set -euo pipefail

hugo \
  --gc \
  --minify \
  --cleanDestinationDir \
  --environment production \
  --logLevel warn
