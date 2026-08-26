#!/usr/bin/env bash
# sync-workspace.sh — 同步开发目录到工作目录 dsh-geometry-plugin（D1）
# 开发主目录：/tmp/geometry-knowledge（独立仓库）
# 工作目录镜像：/Users/oygb/Downloads/GeometryAI-Mac-Build/dsh-geometry-plugin
set -euo pipefail

SRC="${1:-/tmp/geometry-knowledge}"
DST="${2:-/Users/oygb/Downloads/GeometryAI-Mac-Build/dsh-geometry-plugin}"

if [ ! -d "$SRC/src" ] || [ ! -d "$DST" ]; then
  echo "用法: $0 [开发目录] [工作目录]"; exit 1
fi

# 构建产物必须是最新的
(cd "$SRC" && npm run build >/dev/null)

rsync -a --delete "$SRC/src/" "$DST/src/"
rsync -a --delete "$SRC/dist/" "$DST/dist/"
rsync -a --delete "$SRC/tests/" "$DST/tests/"
cp "$SRC/package.json" "$DST/package.json"
cp "$SRC/tsconfig.json" "$DST/tsconfig.json"

echo "已同步 $SRC → $DST"
diff -rq "$SRC/src" "$DST/src" >/dev/null && echo "src 一致 ✓"
diff -rq "$SRC/tests" "$DST/tests" >/dev/null && echo "tests 一致 ✓"
grep '"version"' "$DST/package.json"
