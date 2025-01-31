#!/bin/bash
set -euo pipefail

export HAPPO_ENABLED=true
export HAPPO_E2E_PORT=3000

node --test "./test/*"
