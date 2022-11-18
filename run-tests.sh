set -euo pipefail
for file in ./test/*
do
  node "$file"
done
