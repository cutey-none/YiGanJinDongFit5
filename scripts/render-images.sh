#!/bin/sh
# 把仓库 assets/ 下的矢量示意图转成原生工程用的 PNG（2 倍像素，避免拉伸变形）。
# 用法：./scripts/render-images.sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_dir=$(CDPATH= cd -- "$project_dir/.." && pwd)
out_dir="$project_dir/entry/src/main/js/MainAbility/common/images"
chrome=${CHROME_BIN:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}

if [ ! -x "$chrome" ]; then
  echo "Google Chrome not found: $chrome（可用 CHROME_BIN 指定）" >&2
  exit 1
fi

mkdir -p "$out_dir"
work=$(mktemp -d /tmp/yigangjindong-render.XXXXXX)
trap 'rm -rf -- "$work"' EXIT INT TERM

# 源 SVG：目标 PNG：像素宽：像素高
render() {
  src="$repo_dir/assets/$1"
  dst="$out_dir/$2"
  width="$3"
  height="$4"
  out="$work/$2"
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --default-background-color=00000000 \
    --user-data-dir="$work/profile-$2" --force-device-scale-factor=1 \
    --window-size="$width,$height" --virtual-time-budget=1500 \
    --screenshot="$out" "file://$src" >/dev/null 2>&1 &
  chrome_pid=$!
  waited=0
  while [ ! -s "$out" ] && [ "$waited" -lt 30 ]; do
    sleep 0.5
    waited=$((waited + 1))
  done
  kill "$chrome_pid" 2>/dev/null || true
  wait "$chrome_pid" 2>/dev/null || true
  if [ -s "$out" ]; then
    cp "$out" "$dst"
    echo "rendered $dst (${width}x${height})"
  else
    echo "FAILED to render $1" >&2
    return 1
  fi
}

# 目标设备是圆屏（GT Runner 2 466×466 优先）：内容带宽 420，按显示尺寸 2 倍出图。
# 换设备或改内衬时要同步这里和 sport.css 的显示尺寸，否则图片会被拉伸（引擎不支持 object-fit）。
render pool-hero-wide.svg pool-hero.png 840 172
render rack.svg rack.png 84 84
render pool-hero.svg detail-photo.png 840 336
render table-shot.svg table-shot.png 840 224
render position-map.svg position-map.png 840 244
render posture.svg posture.png 840 320
