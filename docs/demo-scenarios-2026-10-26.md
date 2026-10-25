# 测试服务器演示数据（2026-10-26，新加坡时间）

已在 `timeline.tianyubai.cn` 追加构造演示数据，脚本为 `scripts/demo-scenarios.ts`，数据标识前缀 `demo-scenarios-v1`。虚构证券代码采用 `DEMO-*`，不会混入真实股票研究；公司、资料、事件和来源均显式标注。未修改应用镜像，无需重启服务。

| 演示入口 | 预设结果 |
| --- | --- |
| `/events/demo-scenarios-v1-unverified` | 传闻待核实 |
| `/events/demo-scenarios-v1-supported` | 公告支持分红方案，仍待股东大会审议 |
| `/events/demo-scenarios-v1-conflicted` | 双方对股权比例说法冲突 |
| `/events/demo-scenarios-v1-denied` | 公司公告否认重组传闻 |
| `/events/demo-scenarios-v1-expired` | 意向协议超过有效期 |
| `/events/demo-scenarios-v1-corrected` | 金额更正，历史结论保留 |
| `/events/demo-scenarios-v1-repost` | 同源转载及观点不构成事实支持 |
| `/research/demo-scenarios-v1-research-complete` | 完整结果及已完成的关系核验 |
| `/research/demo-scenarios-v1-research-empty` | 处理完成但零资料、零事项 |
| `/research/demo-scenarios-v1-research-partial` | 覆盖受限，含已分析、待分析、分析失败和日期未知资料 |
| `/research/demo-scenarios-v1-research-failed` | 模拟来源失败，不冒充供应商真实故障 |
| `/research/demo-scenarios-v1-research-cancelled` | 任务取消后资料和事项仍可查询 |

追加总计 7 个人工事件、12 份人工证据资料、5 条研究记录、6 份研究资料、3 个自动事项。构造结论使用现有规则引擎计算，没有直接写死结论状态。研究的来源统计与关系核验为构造结果，不调用外部模型或供应商。全部研究均为终态，不占用后台队列；需要真实研究时另建真实股票代码任务，不对演示记录执行继续检索。

写入前在线一致性备份：`/app/data/backups/before-demo-2026-10-25T19-48-35.705Z.db`（UTC 文件名，持久化数据卷中）。写入后逐表比对备份，911 条原有记录全部保留且内容一致；数据库完整性与外键检查通过。19 个本机 HTTP 入口通过，包含所有案例、自动事项详情、研究列表、事件及资料列表和健康接口。此为 HTTP 服务端渲染验证，未进行浏览器交互验收。

隔离数据库验证：已有种子数据上追加通过；再次执行新增事件及研究均为 0；类型检查通过。脚本先事务写入记录，再使用领域仓储分别回放事件历史；如进程在回放阶段中断，可重复执行恢复结论。脚本会在每次执行前备份。

不要使用 `/api/demo/reset` 来追加本组数据：该接口会重置旧版事件和资料。
