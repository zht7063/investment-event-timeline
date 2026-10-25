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
