#!/bin/sh
# 用 Huawei Lite Wearable 引擎（SDK 自带 Simulator）直接加载构建产物，检查页面能否被运行时接受。
#
# 用途：Lite Wearable 对「单个 JS 文件 ≤ 48KB」有硬限制，超限时页面会被当成快照字节码，
# 日志出现 `JS mode changed unexpected [1]`。这个脚本不需要打开 DevEco Studio 就能跑出该结论。
#
# 用法：./scripts/run-lite-preview.sh [宽] [高] [秒数]
# 默认：480 408 12
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sdk_home=${DEVECO_SDK_HOME:-$HOME/Library/Huawei/Sdk}
deveco_home=${DEVECO_HOME:-/Applications/DevEco-Studio.app/Contents}
hvigor="$deveco_home/tools/hvigor/bin/hvigorw"
simulator="$deveco_home/sdk/default/hms/previewer/liteWearable/bin/Simulator"

width=${1:-480}
height=${2:-408}
seconds=${3:-12}

if [ ! -x "$simulator" ]; then
  echo "Lite Wearable engine not found: $simulator" >&2
  exit 1
fi

work_dir=$(mktemp -d /tmp/yigangjindong-preview.XXXXXX)
cleanup() {
  case "$work_dir" in
    /tmp/yigangjindong-preview.*) rm -rf -- "$work_dir" ;;
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
page_js="$app_dir/pages/index/index.js"
app_js="$app_dir/app.js"

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

echo "page js: $(wc -c < "$page_js" | tr -d ' ') bytes (limit 49152)"
echo "app js : $(wc -c < "$app_js" | tr -d ' ') bytes (limit 49152)"

log="$work_dir/engine.log"
"$simulator" -refresh region -j "$app_dir" -s ygj_preview_1 -cpm false -device liteWearable \
  -shape rect -sd 160 -sid abcdef0123456789abcdef0123456789 -or "$width" "$height" \
  -cr "$width" "$height" -hs 524288 -f "$settings" -n entry -url pages/index/index \
  -ilt false -lws 40095 > "$log" 2>&1 &
engine_pid=$!
sleep "$seconds"
kill "$engine_pid" 2>/dev/null || true
wait "$engine_pid" 2>/dev/null || true

grep -a "ACELite" "$log" | head -20 || true

if grep -qa "JS mode changed unexpected" "$log"; then
  echo "RESULT: FAILED — 有 JS 文件超过 48KB（或被当成快照字节码）"
  exit 1
fi
if grep -qa "init state -> ready state" "$log"; then
  echo "RESULT: PASSED — 运行时已加载页面"
  exit 0
fi
echo "RESULT: UNKNOWN — 请查看 $log"
exit 1
