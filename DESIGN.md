---
version: alpha
colors:
  ink: "#1d1b16"
  paper: "#f6f1e7"
  card: "#fffdf8"
  muted: "#6b6457"
  line: "#d8cfbd"
  accent: "#9a3412"
  focus: "#1d4ed8"
typography:
  display:
    fontFamily: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", serif'
  body:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif'
  data:
    fontFamily: '"SF Mono", "JetBrains Mono", ui-monospace, monospace'
rounded:
  control: "4px"
omitted:
  - section: spacing
    reason: "Existing global CSS owns contextual spacing; no independent generated spacing system."
  - section: components
    reason: "Existing semantic HTML and globals.css own shared control variants."
---

## Overview

中文 A 股证据研究工具，面向查看公告与新闻的个人研究者，桌面查询和手机阅读。沿用现有纸面档案风格，不重设计为交易终端。新页面的识别元素是逐来源覆盖清单与带原文的事件时间线，而非收益数字或涨跌排名。

## Colors

Model B: src/app/globals.css 是 runtime token 的唯一所有者。本文件镜像已存在变量。colors 同名映射至 --ink/--paper/--card/--muted/--line/--accent/--focus。状态沿用 --s-*，必须同时显示文字。

## Typography

display → --serif；body → --sans；data → --mono。中文宋体用于标题及证据原文，无衬线用于表单、状态和辅助说明。日期和代码可使用等宽字体。

## Layout

沿用 main 最大宽度1080px、自然文档滚动和可换行表单。资料列表每页20条。移动端单列，长代码、错误和引用换行。任务进度与控制区位置稳定，局部刷新不移动焦点。

## Elevation & Depth

沿用细边框和纸色卡片，不增加浮层阴影。重要性由标题、来源、日期与状态表达。

## Shapes

控件使用现有4px圆角，保留键盘焦点描边。

## Components

共享 owner 为 globals.css 的 label/input/button、StatusBadge 和研究表单组件。原生日期弹层允许由浏览器拥有，页面标签、错误和日期语义由应用控制（zh-CN、北京时间）。研究任务页面是长任务创建后留在任务详情的明确业务变体。

## Do's and Don'ts

展示来源限制、摘录和待核实标识；不使用完整性百分比或真实性概率。不得用绿色“完成”掩盖部分失败。不用浏览器 alert/confirm。新 UI 复用既有字体和色彩。尊重 reduced-motion，聚焦操作可见。

## Research workspace behavior

首页与 /research 使用同一股票研究工作区；/events 为独立事件库。研究记录按创建时间倒序、每页10项，并显示任务状态和日期区间。共享导航以文字及下划线标记当前位置，导航与主要操作触摸高度至少44px。

详情页先显示任务阶段与最近同步时间，再给出内容跳转和紧凑来源摘要。覆盖缺口始终可见，逐来源检索明细使用原生 details 展开。研究结果保持自然文档滚动，不使用独立滚动面板。日期沿用原生控件，快捷区间按北京时间当天向前计算并包含首尾日期。样式 owner 仍为 globals.css，不新增独立色板。

证据时间线以披露日期为节点主信息；发生、抓取和来源更新时间保持独立标签，作为次级信息。资料折叠行直接显示披露日期与来源，便于区分同名资料。覆盖警示使用 --s-unverified（#78601b），纸色背景上的文字对比度约5.35:1。重试按钮沿用用户确认的36px紧凑描边样式，说明按当前失败、待处理与覆盖限制分别展示。
