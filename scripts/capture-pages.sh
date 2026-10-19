#!/bin/sh
# 不开 DevEco Studio，直接把 Lite Wearable 引擎渲染出来的界面存成图片。
#
# 原理：Lite Wearable 引擎（SDK 自带 Simulator）把每一帧渲染结果通过 WebSocket 发出，
# 首帧是一条带头的 JPEG。本脚本用纯 Python 标准库完成 WebSocket 握手并取一帧。
#
# 关键细节（踩过的坑）：
#   1. 引擎必须以其 bin 目录为工作目录启动，否则找不到 ../config 下的字体，
#      界面会渲染成「只有色块没有文字」。
#   2. 每个引擎实例要占用独立的 -lws 端口，否则会连到上一个实例、拿到旧画面。
#   3. Lite Wearable 单个 JS 文件上限 48KB，超限会在日志里出现 JS mode changed unexpected。
#
# 用法：./scripts/capture-pages.sh [输出目录] [宽] [高] [屏幕形状 rect|circle] [路由 index|sport]
# 默认：./screenshots 480 408 rect
# 例：./scripts/capture-pages.sh screenshots-gtrunner2 466 466 circle   # GT Runner 2 圆屏
#     CAPTURE_PREFIX=sport- ./scripts/capture-pages.sh screenshots/gtrunner2 466 466 circle sport
#
# 注意：输出目录是相对当前工作目录的（要在 native-fit5 里执行）；同一台机器不要并行跑两次，
# 端口会撞在一起、拿到上一次的画面。
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sdk_home=${DEVECO_SDK_HOME:-$HOME/Library/Huawei/Sdk}
deveco_home=${DEVECO_HOME:-/Applications/DevEco-Studio.app/Contents}
hvigor="$deveco_home/tools/hvigor/bin/hvigorw"
previewer_root="$deveco_home/sdk/default/hms/previewer/liteWearable"

out_dir=${1:-"$project_dir/screenshots"}
width=${2:-480}
height=${3:-408}
shape=${4:-rect}
prefix=${CAPTURE_PREFIX:-}

if [ ! -x "$previewer_root/bin/Simulator" ]; then
  echo "Lite Wearable engine not found: $previewer_root/bin/Simulator" >&2
  exit 1
fi

work_dir=$(mktemp -d /tmp/yigangjindong-capture.XXXXXX)
cleanup() {
  case "$work_dir" in
    /tmp/yigangjindong-capture.*) rm -rf -- "$work_dir" ;;
  esac
}
trap cleanup EXIT INT TERM

rsync -a --exclude '.hvigor/' --exclude 'build/' --exclude 'dist/' "$project_dir/" "$work_dir/"

export DEVECO_SDK_HOME="$sdk_home"
export HOS_SDK_HOME="$sdk_home"
export NODE_HOME="$deveco_home/tools/node"

( cd "$work_dir" && "$hvigor" assembleHap --mode module -p product=default \
    -p module=entry@default -p buildMode=debug --no-daemon ) > "$work_dir/build.log" 2>&1

app_dir="$work_dir/entry/build/default/intermediates/loader_out_lite/default/js/MainAbility"
route=${5:-index}
page_js="$app_dir/pages/$route/$route.js"
views="home live setup match training history summary settings"
if [ "$route" = sport ]; then views="home detail workout analysis paused speed rhythm stability position posture history summary"; fi

settings="$work_dir/liteSettings.json"
cat > "$settings" <<'JSON'
{
  "setting": {
    "1.0.0": {
      "KeepScreenOnState": { "args": { "KeepScreenOnState": true } },
      "Brightness": { "args": { "Brightness": 170 } },
      "WearingState": { "args": { "WearingState": true } },
      "HeartRate": { "args": { "HeartRate": 100 } },
      "StepCount": { "args": { "StepCount": 0 } },
      "Barometer": { "args": { "Barometer": 101325 } },
      "Power": { "args": { "Power": 0.62 } },
      "Language": { "args": { "Language": "zh-CN" } }
    }
  },
  "frontend": {
    "1.0.0": {
      "Resolution": { "args": { "Resolution": "WIDTH*HEIGHT" } },
      "DeviceType": { "args": { "DeviceType": "liteWearable" } }
    }
  }
}
JSON
sed -i '' "s/WIDTH\*HEIGHT/${width}*${height}/" "$settings" 2>/dev/null || \
  sed -i "s/WIDTH\*HEIGHT/${width}*${height}/" "$settings"

mkdir -p "$out_dir"
cp "$page_js" "$work_dir/page.js.orig"

port=40180
for view in ${CAPTURE_VIEWS:-$views}; do
  port=$((port + 1))
  python3 - "$page_js" "$view" <<'PY'
import sys
path, view = sys.argv[1], sys.argv[2]
src = open(path).read()
open(path, 'w').write(src.replace("view: 'home'", "view: '%s'" % view, 1))
PY
  ( cd "$previewer_root/bin" && ./Simulator -refresh region -j "$app_dir" -s ygj_capture \
      -cpm false -device liteWearable -shape "$shape" -sd 160 \
      -sid abcdef0123456789abcdef0123456789 -or "$width" "$height" -cr "$width" "$height" \
      -hs 524288 -f "$settings" -n entry -url "pages/$route/$route" -ilt false \
      -lws "$port" > "$work_dir/engine_$view.log" 2>&1 ) &
  engine_pid=$!
  sleep 4
  python3 "$project_dir/scripts/lib/ws_frame.py" "$port" "$out_dir/$view.jpg" || true
  kill "$engine_pid" 2>/dev/null || true
  cp "$work_dir/engine_$view.log" "$out_dir/$view.log"
  cp "$work_dir/page.js.orig" "$page_js"
  if [ -f "$out_dir/$view.jpg" ]; then
    if [ -n "$prefix" ] && [ -f "$out_dir/$view.jpg" ]; then
      mv "$out_dir/$view.jpg" "$out_dir/$prefix$view.jpg"
    fi
    if [ -n "$prefix" ] && [ -f "$out_dir/$view.log" ]; then
      mv "$out_dir/$view.log" "$out_dir/$prefix$view.log"
    fi
    echo "captured $out_dir/$prefix$view.jpg"
  else
    echo "FAILED to capture $view (see $work_dir/engine_$view.log)" >&2
  fi
done

wc -c "$app_dir/app.js" "$app_dir/pages/index/index.js" "$app_dir/pages/sport/sport.js"
echo "渲染分辨率：${width}x${height}（${shape}）；页面脚本 $(wc -c < "$page_js" | tr -d ' ') 字节（上限 49152）"
