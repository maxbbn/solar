<img src="assets/icon.svg" width="96" height="96" alt="">

# True Scale Solar System

[English](README.md) | **简体中文** | [日本語](README.ja.md)

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

## 构建

源码可直接运行；部署的是 `dist/` 中的生产构建：

```sh
npm install
npm run build     # 输出到 dist/
npm run preview   # 构建后在 http://localhost:8766 预览 dist/
```

`tools/build.mjs` 将脚本合并并压缩为三个包（three.js、星表与贴图清单、应用代码）并生成 source map，压缩 CSS 与 HTML，行星贴图以独立图片提供，不再使用 base64 的 `assets/textures.js`。除 `index.html` 外，所有文件名都带内容哈希，`dist/_headers` 让 `/assets/*` 缓存一年（`immutable`）；`index.html` 每次都会重新验证，因此发布新版本后下次打开即生效。Cloudflare 通过 `wrangler.jsonc` 中的 `build.command` 执行构建。

## 目录

- `js/i18n.js` 语言检测与切换
- `js/iss.js` 国际空间站轨道、过境预报与模型（更新轨道：替换文件顶部的 `ISS_TLE`，可从 celestrak.org 获取）
- `js/astro.js` 星历、天体数据、日月食搜索
- `js/missions.js` 轨道力学（通用变量开普勒传播、Lambert、任务设计）
- `js/tiles.js` 相机靠近地球时，从 NASA GIBS 流式加载周围的卫星影像（Blue Marble、VIIRS 夜间灯光、海陆掩膜）；离线时退回内置贴图
- `js/scene.js` 渲染（浮动原点 + 对数深度缓冲，实现米到天文单位的真实比例）
- `js/app.js` 相机、时间、界面
- `assets/` 打包后的贴图与星表（由 `tools/build_data.py` 从 `tex_src/` 生成；月球颜色与法线贴图由 `tools/build_moon.py` 生成）

贴图 © Solar System Scope，CC BY 4.0；月球颜色与地形来自 NASA SVS CGI Moon Kit（LRO LROC/LOLA）；地球近景影像来自 NASA GIBS（Blue Marble Next Generation、VIIRS Black Marble）与 OpenStreetMap 海陆数据（© OpenStreetMap 贡献者，ODbL）；星表与星座连线来自 d3-celestial（BSD-3）。
