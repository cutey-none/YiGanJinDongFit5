# 一杆进洞 · HUAWEI WATCH FIT 5 原生工程

这是基于华为官方 Lite Wearable 工程路线的首个原生版本骨架。

## 目标设备（优先级从高到低）

1. **HUAWEI WATCH GT Runner 2** — 466×466 圆屏，**首选真机**，界面按它排版
2. HUAWEI WATCH GT 6 / GT 6 Pro / GT 7 / GT 7 Pro — 同为 GT 系列圆屏，走同一条路线（未实测）
3. HUAWEI WATCH FIT 5 — 480×408 方屏，用同一套圆屏优先排版（显示成居中一列）

GT 系列属于 Lite Wearable，走 HML/CSS/JS（ArkUI.Lite），不需要改用 ArkTS；依据与实测见
`../docs/gtrunner2-compat-check.md`。

## 一键构建

由于华为 Hvigor 不接受包含中文的工程路径，构建脚本会自动在 `/tmp` 创建纯英文镜像，完成后将 HAP/BIN 放到 `dist/`。

```bash
chmod +x scripts/build-fit5.sh
./scripts/build-fit5.sh            # debug（默认）：本地开发与引擎验证
./scripts/build-fit5.sh release    # release：压缩过的发布包，用于签名与真机安装
```

脚本在有签名配置时导出 `dist/yigangjindong-fit5-<模式>-signed.hap`，否则导出
`-unsigned.hap`；debug 的 BIN 同样按实际签名状态命名。真机复测选择本次生成的
`release-signed.hap`，不要误选 `dist/` 中旧的 unsigned 包。release 构建模式不改变
Profile 类型：使用 debug Profile 签出的包仍是调试签名，正式发布需要发布 Profile。

release 构建会把 JS 压缩（页面约 33KB、app.js 约 18.5KB），远低于 Lite Wearable 的 48KB 单文件上限；
debug 构建不做压缩（sport 页约 42KB、app.js 约 44KB），是开发期需要注意的预算，加功能前后都要跑
`./scripts/run-lite-preview.sh` 确认没有超限。

官方资料确认：FIT 系列属于 Lite Wearable；工程类型应选择 `[Lite] Empty Ability` + `Lite Wearable`，页面使用 HML/CSS/JS。该目录已经把首页、对局设置、对局记录、训练、历史和总结迁移为可在 DevEco Studio 中继续构建的原生工程。

## 使用条件

- DevEco Studio 5.0.5 Release 或更高版本
- HarmonyOS 5.0.5 Release SDK 或更高版本
- 已完成华为开发者实名认证
- FIT 5 设备、配套 iPhone/华为运动健康

本项目采用 DevEco Studio 内置的 **Huawei Lite Wearable Simulator** 作为主要开发和调试设备。该模拟器可以直接运行和调试已签名或未签名 HAP，并能模拟屏幕、佩戴状态、心率、步数和地理位置。开发阶段不依赖旧鸿蒙或 Android 手机。

真机最终验收通过 AppGallery Connect 的测试/发布包完成：在 iPhone 或鸿蒙单框架手机的华为运动健康中，将应用安装到 FIT 5。

华为官方已明确说明 FIT 5 支持 iOS 运动健康应用市场。应用采用纯手表离线架构，不依赖 Android 手机伴生应用，以确保 iOS 和 HarmonyOS 5+ 两端的主要记录功能一致。

## 在 DevEco Studio 中打开

本机 DevEco Studio 打开 `~/DevEcoProjects/YiGanJinDongFit5`（全英文路径），等待项目同步。
该目录已同步仓库 `native-fit5` 的最新源码、资源与脚本，包名为 `com.xxl.wqy.bobo.ergou.hole_in_one`。
仓库中的 `native-fit5` 保留用于 Git 版本管理；修改原生代码后必须同步到 DevEco 工程，避免运行旧副本。
同步时保留目标工程的 `build-profile.json5`（本地签名配置）及 `.idea/`，不复制构建缓存和产物：

```bash
# 在仓库根目录执行；不使用 --delete，不删除目标工程的本地文件
rsync -a --exclude '.idea/' --exclude '.cache/' --exclude '.hvigor/' \
  --exclude 'build/' --exclude 'dist/' --exclude 'file_system/' \
  --exclude '/build-profile.json5' \
  native-fit5/ ~/DevEcoProjects/YiGanJinDongFit5/
```

`scripts/render-images.sh` 依赖仓库的 `assets/`，须在仓库中生成资源后再同步；构建、算法测试与运行时加载检查可直接在 DevEco 工程目录执行。

在设备下拉框中选择 **Huawei Lite Wearable Simulator**，设置矩形屏幕及 FIT 5 对应分辨率，然后点击 Run 或 Debug。模拟器支持未签名 HAP，因此本地开发阶段不需要设备 UDID。

首次真实 FIT 5 测试前，需要在 AppGallery Connect 创建 HarmonyOS App、申请发布证书和发布 Profile，并上传测试包。

## 当前实现

- 十个运动界面：首页、玩法详情、运动中、本杆分析、暂停/结束、出杆速度、行律、出杆稳定性、入位稳定性、姿势检测
  （与产品图逐屏对齐，见仓库根 `docs/reference/prd-watch-screens.jpg`；排版按 GT Runner 2 圆屏，
  FIT 5 上是同一套排版的居中一列）
- 运动生命周期：开始 / 暂停 / 继续 / 结束，暂停与恢复之间不串杆（`common/workout.js`）
- 本杆分析可逐杆回看（上一杆 / 下一杆），总结页与运动记录都能点进回看
- 产品图之外的辅助页：热量详情（从「运动中」的热量卡片进入）
- Lite Wearable `config.json`
- 适配 FIT 系列的 `deviceType: liteWearable`
- 8 球、9 球对局
- 我赢 / 对手赢 / 犯规 / 清台 / 撤销
- 先赢 1/3/5 局
- 训练计时和成功/失败计数
- 历史记录
- 本地存储（`@system.storage`，单键 JSON，无演示数据）
- 真实传感器面板：心率、热量、出杆次数、出杆速度、出杆稳定性、入位稳定性
- 设置页：性别 / 年龄 / 体重（热量估算）、振动开关、运动数据开关
- 振动反馈（`@system.vibrator`）、真实电量显示（`@system.battery`）
- 右滑退出

## 代码结构（重要）

```text
entry/src/main/js/MainAbility/
  app.js                     应用级：真实传感器订阅 + 出杆算法引擎 + 会话统计 + 持久化
  common/metrics.js          纯算法层（无系统依赖，可在 Node 下离线验证）
  common/workout.js          运动生命周期 + 有界出杆历史 + 统计聚合（纯函数，同样可离线验证）
  pages/index/index.{js,hml,css}   页面：只做界面状态与用户操作，通过全局 $app 调用
  pages/sport/sport.{js,hml,css}   台球十屏页面（计时、本杆分析、四个数据详情、姿势检测）
scripts/build-fit5.sh        一键构建（/tmp 英文镜像 → hvigor → dist/）
scripts/test-metrics.mjs     算法离线验证（合成 IMU 轨迹 + 物理模型标准答案，24 项断言）
scripts/bench-metrics.mjs    算力余量评估（按真机采样率压测算法层）
scripts/capture-pages.sh     不开 DevEco，直接让引擎渲染页面并存成图片（sport 路由 12 页；可指定分辨率与方/圆屏，CAPTURE_PREFIX 加文件名前缀）
scripts/render-images.sh     把 ../assets 下的矢量示意图渲染成 common/images 里的 PNG（2 倍像素，避免拉伸）
screenshots/<机型>/          上述脚本产出的界面样张，按机型分目录（gtrunner2 为首选、fit5 次之）
```

**为什么算法层在 app.js**：Lite Wearable 运行时限制「单个 JS 文件 ≤ 48 KB」
（ACELite `FILE_CONTENT_LENGTH_MAX = 1024 * 48`），超限的页面会被当成快照字节码并加载失败
（日志 `JS mode changed unexpected [1]`）。把大块逻辑放进与页面平级的 `app.js`，页面脚本
才能留在预算内。改动页面时请重新确认页面脚本体积：

```bash
./scripts/build-fit5.sh   # 构建日志里会生成 loader_out_lite
wc -c /tmp/<本次镜像>/entry/build/default/intermediates/loader_out_lite/default/js/MainAbility/pages/index/index.js
```

## 验证方式

1. 算法：`node scripts/test-metrics.mjs`（24/24 通过）；算力：`node scripts/bench-metrics.mjs`。
2. 页面能否被运行时加载：用 SDK 自带的 Lite Wearable 引擎直接跑
   `…/sdk/default/hms/previewer/liteWearable/bin/Simulator -j <loader_out_lite 的 MainAbility 目录> …`
   ，日志里出现 `init state -> ready state` 即通过；出现 `JS mode changed unexpected` 说明
   某个 JS 文件超过 48 KB。
   直接跑 `./scripts/run-lite-preview.sh` 即可（会自动构建、跑引擎并打印体积与结论）。
3. 界面与交互：DevEco Studio → 设备选 **Huawei Lite Wearable Simulator** → Run，再在画布上点击。
   模拟器只提供 心率/气压/步数/佩戴 四种传感器，加速度计与陀螺仪需要在真机验证。
4. 排版：让引擎按机型真实渲染并逐页检查裁切（不依赖 DevEco）。

   ```bash
   cd native-fit5
   CAPTURE_PREFIX=sport- ./scripts/capture-pages.sh screenshots/gtrunner2 466 466 circle sport   # 首选真机
   CAPTURE_PREFIX=sport- ./scripts/capture-pages.sh screenshots/fit5 480 408 rect sport
   python3 ../scripts/check-circle-safe.py screenshots/gtrunner2 sport-                          # 圆屏不裁切检查
   ```

   **输出目录是相对当前工作目录的，要在 `native-fit5` 里执行；两次捕获不要并行跑**（端口会撞、拿到上一轮画面）。
   圆屏真机看不到方框图的四个角，所以圆屏样张必须再过一遍 `check-circle-safe.py`。
5. 真机：步骤见 `../docs/fit5-install-and-device-test.md`（签名 → AppGallery Connect 测试包 →
   华为运动健康应用市场 → 打开「实时数据」页看底部自检行与原始读数）。

## HML/CSS 注意事项（ACELite 实测）

- 每个 JS 文件 ≤ 48 KB（当前 sport 页约 41.5 KB；**app.js 约 43.5 KB 是最紧的一个**，
  加功能前先跑 `run-lite-preview.sh` 看体积）。
- **`class` 属性不支持数据绑定**（构建期直接报 `class selector does not support data binding`），
  `style` 属性支持。要在运行时切两套排版，就用 `style="{{...}}"`，别用 `class="{{...}}"`。
- **百分比宽度按父盒的边框盒算，不扣 padding**：想收窄内容要用一条固定宽度的居中列
  （sport 页的 `.frame`，宽 420；顶栏 260、主按钮 330、标题行 370 单独收窄），别指望靠 root 的左右 padding 收窄。
- 引擎里 `@system.storage` 的回调不保证按时回来（实测要等 WebSocket 客户端连上才触发）：
  应用级代码不能把「就绪」完全押在回调上，`app.js` 用 1.5s 超时兜底，写队列用 0.8s 超时兜底。
- 引擎里 `@system.device.getInfo()` 拿不到（实测返回不可用）：圆屏 / 方屏的判断目前只能靠
  固定排版 + 真机验证，不要写依赖 `screenShape` 的逻辑而不验证。
- 容器 div 必须写显式的 `width` + `height`，否则子元素不渲染。
- 同一行里放两个 `<text>` 时第二个不渲染，要各自包一层带显式宽高的 div（见 `.row-main` / `.row-side`）。
- CSS 只支持单类名选择器，不要写 `.a.b` 或 `> div` 这种组合。
- **canvas 必须同时写 `id` 和 `ref`，并且用 `this.$refs.<ref>` 取元素**：`this.$element()` 在 Lite Wearable
  引擎里是 `undefined`；`ref` 只在元素渲染之后才出现在 `$refs` 里，所以要在 `setTimeout` 之后再画一次。
- **canvas 的 `beginPath()+arc()+fill()` 不生效**（`fillRect` / `moveTo+lineTo+stroke` 正常）：实心圆用
  「半径 R/2 + 线宽 R 的粗描边」画；曲线下的填色用等宽竖线拼；虚线用短线段循环画。`#RRGGBBAA` 这类
  带透明度的颜色也不受支持，请用不透明色。
- 图片要按显示尺寸的宽高比出图，否则会被拉变形（`scripts/render-images.sh` 里已按显示尺寸 2 倍出图）。

## 传感器可用性

模拟器实测 `@system.sensor` 只暴露
`subscribeBarometer / subscribeStepCounter / subscribeHeartRate / subscribeOnBodyState`，
没有加速度计与陀螺仪接口。代码按传感器逐个探测，缺失时界面直接标注不可用，不显示假数据。
FIT 5 真机是否开放加速度计/陀螺仪仍需真机确认，详见 `../docs/huawei-fit5-research.md`。

正式发布前还需要在 DevEco Studio 进行签名、HAP 构建、AppGallery Connect 测试包上传，并在真实 FIT 5 上完成 iPhone 与鸿蒙单框架手机两条安装链路的验收。

## License

本项目基于 [MIT License](LICENSE) 开源。
