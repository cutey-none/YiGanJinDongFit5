#!/bin/sh
set -eu

# 用法：./scripts/build-fit5.sh [debug|release]
# debug（默认）：本地开发/引擎验证用
# release：签名的前置产物，用于 AppGallery Connect 测试包与真机安装
mode=${1:-debug}
case "$mode" in
  debug|release) ;;
  *) echo "build mode must be debug or release" >&2; exit 1 ;;
esac

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sdk_home=${DEVECO_SDK_HOME:-$HOME/Library/Huawei/Sdk}
deveco_home=${DEVECO_HOME:-/Applications/DevEco-Studio.app/Contents}
node_home="$deveco_home/tools/node"
hvigor="$deveco_home/tools/hvigor/bin/hvigorw"

if [ ! -x "$hvigor" ]; then
  echo "DevEco Studio build tool not found: $hvigor" >&2
  exit 1
fi

if [ ! -f "$sdk_home/HarmonyOS-6.0.1/sdk-pkg.json" ]; then
  echo "HarmonyOS SDK is not initialized under: $sdk_home" >&2
  exit 1
fi

build_root=$(mktemp -d /tmp/yigangjindong-fit5.XXXXXX)
cleanup() {
  case "$build_root" in
    /tmp/yigangjindong-fit5.*) rm -rf -- "$build_root" ;;
  esac
}
trap cleanup EXIT INT TERM

build_project="$build_root/native-fit5"
mkdir -p "$build_project"
rsync -a \
  --exclude '.hvigor/' \
  --exclude 'build/' \
  --exclude 'dist/' \
  "$project_dir/" "$build_project/"

export DEVECO_SDK_HOME="$sdk_home"
export HOS_SDK_HOME="$sdk_home"
export NODE_HOME="$node_home"

(
  cd "$build_project"
  "$hvigor" assembleHap \
    --mode module \
    -p product=default \
    -p module=entry@default \
    -p buildMode="$mode" \
    --no-daemon
)

output_dir="$project_dir/dist"
mkdir -p "$output_dir"
build_output="$build_project/entry/build/default/outputs/default"
# 有本地签名配置时优先导出已签名 HAP，避免把未签名包拿去真机安装。
signature=unsigned
if [ -f "$build_output/entry-default-signed.hap" ]; then
  signature=signed
fi
cp "$build_output/entry-default-$signature.hap" \
  "$output_dir/yigangjindong-fit5-$mode-$signature.hap"

# release 构建不产出 .bin（.bin 只有 debug/本地调试时需要）
if [ -f "$build_output/bin/entry-default-$signature.bin" ]; then
  cp "$build_output/bin/entry-default-$signature.bin" \
    "$output_dir/yigangjindong-fit5-$mode-$signature.bin"
fi

echo "Build complete:"
ls -lh "$output_dir"/yigangjindong-fit5-"$mode"-"$signature".*
