# UI behavior contract

## Business sources

- docs/title-投资事件情报与证据时间线.md：四类时间、来源追溯、不得确定性预测。
- docs/stock-research-plan.md：后台任务、自动分析、区间过滤、部分失败与恢复。
- docs/research-capabilities.md：片段限制和来源覆盖文案。
- readme.md：单实例共享数据、公开导入的现有权限边界。研究任务沿用共享查询；不新增账户、私密查询或持仓。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Date | ResearchForm native date fields | ResearchInput date validation | native popup owned by browser | keyboard and browser tests |
| Form | ResearchForm and domain/research.ts | ResearchInput | research job creation | invalid field focus, no duplicate submit |
| Scrollbar | src/app/globals.css | DESIGN.md | global baseline | computed style |
| Toast | persistent inline role=status/alert | this contract | task progress/error | live-region browser test |
| CRUD | research API + ResearchClient | stock-research-plan | create→job detail; retry stays; cancel preserves results | full-flow tests |
| Select/Listbox | existing native selects | DESIGN.md | existing workflows only; research form has none | existing smoke |

## Flow ledger

开始分析 → 按钮保持尺寸并禁用 → 跳转 /research/:id → 显示任务进度。表单本地校验失败保留输入并聚焦首个错误。创建请求重试复用幂等键，避免未知结果时重复任务。

研究任务轮询失败保留上次结果，提示连接中断并提供重试；刷新恢复 URL 中的任务 ID 和页码。取消只停止后续处理，已有资料保留，不删除共享资料。重试只继续未完成部分，已完成分析复用。不存在的任务显示404与返回入口。

## Data and state

检索完成、覆盖穷尽、模型分析、关系核验分开表达。日期未知资料单列且不进入区间结论。关系分析未完成时结果明确标记初步；失败时不能显示已完成的正常结论。页大小20，分页状态持久化 URL；查询列表没有选择/批量删除。

## Accessibility and locale

zh-CN / Asia/Shanghai。原生日期选择的浏览器弹层为允许平台行为，页面时间标签明确北京时间。表单 noValidate 并使用内联错误、aria-invalid/aria-describedby、错误聚焦。按钮链接原生语义、disabled/busy、hover/focus/active。窄屏不截断操作，错误不只靠颜色。已有页面未触及的行为差异作为旧版迁移范围，不为此重写全部产品。

## Migration scope

本轮 premium-ui.json 严格审计新增研究流程。已有导入页的浏览器验证、可缩放 textarea 等历史差异不作为新规范，不在本轮重写。跨页面字体、状态徽章和全局滚动条由现有共享实现承接；新增研究表单使用上述统一行为。
