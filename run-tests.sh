#!/bin/bash
set -euo pipefail

export HAPPO_ENABLED=true
export HAPPO_E2E_PORT=3000

if [[ $(node -v | cut -d. -f1 | tr -d 'v') -ge 22 ]]; then
  node --test "./test/*"
else
  node --test test
fi
