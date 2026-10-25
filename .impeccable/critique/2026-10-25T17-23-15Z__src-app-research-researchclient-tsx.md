---
target: 研究结果页再次设计检查
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/root/projects/investment-event-timeline/src/app/research/ResearchClient.tsx"
target_fingerprint: "sha256:5dd75b74abeafdc56c783149f9462aa9b1baffb0c94e806bbd2f57a612423d1e"
target_path: /root/projects/investment-event-timeline/src/app/research/ResearchClient.tsx
timestamp: 2026-10-25T17-23-15Z
slug: src-app-research-researchclient-tsx
closed: true
---
Method: dual-agent (A: /root/review_current · B: /root/detect_current)

研究结果页复核：27/40，可用，建议局部优化。目标 src/app/research/ResearchClient.tsx；使用构造资料在818px与390px检查待处理、处理中、部分完成与展开证据。

设计针对性：纸面档案、原文摘录、来源限制与冲突呈现适合个人股票研究。保留现有方向、时间线竖线及用户确认的紧凑按钮。

|启发式|分数|问题|
|---|---:|---|
|系统状态|3|长时间排队的解释有限|
|现实语义|3|“已遍历接口结果”偏实现术语|
|用户控制|3|返回、停止、重试均可用|
|一致性|3|字体与交互整体一致|
|错误预防|3|忙碌禁用、范围警示明确|
|识别而非记忆|2|同标题资料缺少外露日期来源|
|效率|2|比较资料需要反复展开|
|美观简洁|3|移动端说明重复|
|错误恢复|3|重试范围不清|
|帮助|2|恢复与排队说明有限|
|合计|27/40|可用|

优势：信任边界清楚；后台阶段与返回记录明确；时间线、原文引用与纸面视觉协调。

1. [P2] 收录资料折叠行只有标题与分析状态，同标题资料无法区分。将披露日期与来源展示在折叠行。命令 impeccable clarify。
2. [P2] 时间线突出分类与来源，披露日期却混在发生、抓取、更新时间中。以披露日期为节点主锚点，其余时间降级分组，保留语义。命令 impeccable typeset。
3. [P2] 部分完成且全部资料已分析时，“重试未完成部分”未说明剩余操作。按失败、待分析与覆盖限制分别解释可恢复部分，不暗示重试能消除来源限制。命令 impeccable clarify。
4. [P2] 手机端结果前的覆盖、完成与自动分析说明重复。合并重复说明，保留具体来源缺口与一条自动分析提示。命令 impeccable distill。
5. [P2] coverage-warning 对比度4.4:1，略低于普通文字4.5:1。适度加深警示文字颜色，保持纸面配色。位置globals.css:10,315，ResearchClient.tsx:177。命令 impeccable polish。

认知负担中等：资料识别及多种时间混排造成额外记忆负担，主要操作没有超过4个竞争选项。
人物：高频研究者需要反复展开同标题资料；低视力用户受低对比警示影响；手机读者需滚过重复说明及多行时间。情绪旅程：等待阶段得到安抚，部分完成后的重试价值仍不明确，冲突呈现诚实。

次要观察：“已遍历接口结果”宜改为使用者语言；紧凑36px按钮是用户选择，不建议恢复笨重外观，可另行增加透明触控范围。实测Chromium证据链接能自动展开details并定位，无需修复。

检测：CLI 0项；浏览器2个元素组、3条规则，包含真实的低对比问题及纸色、条纹两个已明确采用的风格提示。没有用户可见检测浮层。演示样本小，不能替代大量事件、实际读屏器或跨浏览器验收。
