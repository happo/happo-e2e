#!/bin/bash
set -euo pipefail

export HAPPO_ENABLED=true
export HAPPO_E2E_PORT=3000

for file in ./test/*
do
  echo ""
  echo "Running test $file"

  node "$file"

  echo "✅ Test $file passed!"
done
