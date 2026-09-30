# True Scale Solar System

真实比例、实时星历的太阳系模拟器（纯前端，three.js）。

- 行星位置：JPL 近似开普勒根数（1800–2050 年精度最佳）；月球：含主要摄动项的月球理论（误差约 1–2′）
- 视角：太空环绕、站在地球/月球/火星表面，真实视直径，望远镜变焦
- 时间：实时到 1 年/秒，倒流，跳转任意日期，自动搜索下一次日食/月食
- 任务：地月转移（拼接圆锥曲线）、火星/金星/木星转移（Lambert 求解 + 发射窗口 Δv 图），全部为时间的解析函数，可随意快进、倒退
- 国际空间站：真实 TLE 轨道（含 J2 进动与大气阻力项），程序化模型（太阳翼自动对日），跟随视角、穹顶舱舷窗视角，地面「等空间站飞过」可见过境预报
- 光速演示：从任意天体发出一束光，看它多久到达其他行星
- 界面：默认只显示画面、时钟和时间条；左侧导航打开视角 / 天体 / 任务面板，右侧工具栏常驻标签、轨道、星座开关，以及沉浸模式（I 键，Esc 退出）和设置（语言、快捷键、致谢）
- 中英双语：默认跟随浏览器语言（系统语言变化时自动切换），左上角可手动选择；界面文字都用 `tr(中文, English)` 成对书写（`tr` 定义在 `js/i18n.js`），切换语言无需刷新

## 运行

直接双击 `index.html`，或：

```sh
python3 -m http.server 8765   # 然后打开 http://localhost:8765
```

深链接：`#onEarth` `#onMoon` `#onMars` `#inner` `#outer` `#saturnBack` `#eclipse-solar` `#eclipse-lunar` `#mission-moon` `#mission-mars` `#cockpit-moon`（发射探月任务并进入驾驶视图） `#iss` `#cupola`

## 目录

- `js/i18n.js` 语言检测与切换
- `js/iss.js` 国际空间站轨道、过境预报与模型（更新轨道：替换文件顶部的 `ISS_TLE`，可从 celestrak.org 获取）
- `js/astro.js` 星历、天体数据、日月食搜索
- `js/missions.js` 轨道力学（通用变量开普勒传播、Lambert、任务设计）
- `js/scene.js` 渲染（浮动原点 + 对数深度缓冲，实现米到天文单位的真实比例）
- `js/app.js` 相机、时间、界面
- `assets/` 打包后的贴图与星表（由 `tools/build_data.py` 从 `tex_src/` 生成）

贴图 © Solar System Scope，CC BY 4.0；星表与星座连线来自 d3-celestial（BSD-3）。
