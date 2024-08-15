set -euo pipefail
for file in ./test/*
do
  echo ""
  echo "Running test $file"

  node "$file"

  echo "✅ Test $file passed!"
done
