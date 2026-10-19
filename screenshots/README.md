# 界面渲染截图（按机型分目录）

这些图片不是手绘稿，也不是 mock：由 `../scripts/capture-pages.sh` 让 **Lite Wearable 引擎真实渲染**后
从引擎的 WebSocket 帧里取出的 JPEG。

设备优先级：**GT Runner 2（466×466 圆屏）优先**，其后 GT 6 / GT 6 Pro / GT 7 / GT 7 Pro，最后 FIT 5（480×408 方屏）。

| 目录 | 设备 | 分辨率 | 内容 |
| --- | --- | --- | --- |
| `gtrunner2/` | HUAWEI WATCH GT Runner 2 | 466×466 圆屏 | `sport-*`：台球十屏（主交付）；`index-*`：保留的记分 / 训练页 |
| `fit5/` | HUAWEI WATCH FIT 5 | 480×408 方屏 | `sport-*`：同一套圆屏优先排版（居中一列）；`index-*`：保留的记分 / 训练页 |

重新生成（**要在 `native-fit5` 里执行；两次捕获不要并行跑，端口会撞**）：

```bash
cd native-fit5
CAPTURE_PREFIX=sport- ./scripts/capture-pages.sh screenshots/gtrunner2 466 466 circle sport
CAPTURE_PREFIX=sport- ./scripts/capture-pages.sh screenshots/fit5 480 408 rect sport
CAPTURE_PREFIX=index- ./scripts/capture-pages.sh screenshots/gtrunner2 466 466 circle index
```

圆屏样张要额外过一遍「有没有被圆边切掉」的检查（真机是圆表盘，引擎吐的是整张方框图）：

```bash
python3 ../scripts/check-circle-safe.py screenshots/gtrunner2 sport-
```

注意：模拟器只提供心率、气压、步数、佩戴四种传感器，所以出杆类指标在这些截图里显示 `--`，
这是如实显示「传感器不可用」，不是占位数字。真机是否提供加速度计/陀螺仪见
`../../docs/huawei-fit5-research.md`。
