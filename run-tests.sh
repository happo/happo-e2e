#!/bin/bash
set -euo pipefail

if [[ $(node -v | cut -d. -f1 | tr -d 'v') -ge 22 ]]; then
  node --test "./test/*"
else
  node --test test
fi
