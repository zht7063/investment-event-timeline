# 项目架构文档

本项目是一个以原文证据为中心的 A 股事件研究应用：Next.js 同时提供页面与 HTTP API，独立研究 worker 执行长任务，预设标的同步进程负责周期采集，三者共享 SQLite。人工确认的事件链与自动研究的结果分别存储，通过统一事件库查询；模型参与抽取和关系建议，最终结论状态由程序规则计算。

- **架构图**：[打开 Archify 交互架构图](architecture/architecture.html)
- **可编辑图源**：[candidate.json](architecture/candidate.json)
- **代码基线**：`ab0653da2d4dae76fc422edc59d7263fd449fb3d`
- **文档日期**：2026-10-26（Asia/Singapore）
- **范围**：当前仓库实现、部署配置、数据模型与运行边界。部署记录是历史证据，本次没有访问线上系统或调用付费供应商。

架构图是系统运行职责概览。图中的 Web 节点包含页面、路由及其进程内服务；外部接口节点合并展示 iFinD、扶摇和模型接口。它们不是同一家服务，也不共享凭证。函数依赖、表关系和可选反向代理在下文展开。

## 1. 业务范围与关键约束

系统支持按股票与披露日期研究、资料导入、证据关联、冲突保留、结论历史和事件/资料统一查询。它不实现交易、持仓管理、收益预测或多租户私密研究空间。

| 约束 | 实现含义 |
| --- | --- |
| 可追溯 | 论断保存原文摘录、位置、来源与资料版本；摘要关联证据 ID |
| 保守合并 | 同公司不等于同事项；自动跨资料归并需要可验证的对象与期次 |
| 时间分离 | 发生、披露、抓取、来源更新时间分别处理；未知时间不猜测 |
| 自动与人工分离 | 自动研究不写入人工 `events/event_evidence`，不冒充人工确认 |
| 渐进结果 | 收录后可查询资料；逐份分析后更新报告和事件索引 |
| 失败可恢复 | 保留已有资料与检查点；失败来源、分析、关系可重试 |
| 覆盖诚实 | 片段/摘要不等于全文，接口遍历不等于全网穷尽 |

## 2. 技术栈与代码组织

版本取自 [package.json](../package.json)：Node.js ≥24、Next.js 16.4.3、React 19.3.1、TypeScript 5.9.3、Zod 4.6.7、Vitest 5.0.5、Playwright 1.64.1。数据库使用 Node 内置 `node:sqlite` 的 `DatabaseSync`，没有 ORM、独立数据库服务、Redis 或消息代理。

| 目录/模块 | 职责 | 主要调用方 |
| --- | --- | --- |
| `src/app/` | App Router 页面、客户端交互与 API Route Handlers | 浏览器 |
| `src/components/` | 导航、状态标签等共享 UI | 页面 |
| `src/domain/` | 时间、匹配、证据权重、结论与研究输入等领域规则 | 页面、服务、worker |
| `src/server/db.ts`、`schema.sql` | 数据库初始化、DDL、短事务 | 所有服务器进程 |
| `src/server/ingest.ts`、`versions.ts` | 入库去重、抽取预览、手动论断、人工关联与撤销 | 导入 API、同步 |
| `src/server/repo.ts` | 人工事件读取、结论重算与历史回看 | 页面、API、导入服务 |
| `src/server/library.ts` | 人工与自动事件/资料联合查询 | 事件库页面、API |
| `src/server/research/` | 任务存储、数据源适配、分析、报告、索引、worker | 研究 API、独立进程 |
| `src/server/sources/` | 预设标的同步、iFinD/扶摇/MCP 连接器 | 同步脚本、管理 API、行情 API |
| `src/server/ai.ts`、`http.ts` | 人工链模型抽取、原文校验、出站请求策略 | 导入、同步、研究分析 |
| `scripts/` | 同步循环、研究 worker、备份、探测、回填 | CLI、Compose、systemd |
| `deploy/` | Caddy 与直接运行的 systemd 配置 | 部署人员 |
| `tests/` | 领域单测、数据库集成测试、浏览器回归 | Vitest、Playwright |

`@/` 是源码别名。领域计算与 I/O 分离；`research/analysis.ts` 仍同时包含模型调用和纯校验/归并逻辑，不应误认为整个研究目录都是纯函数层。

## 3. 运行单元与调用关系

### 3.1 Web 进程

服务器组件直接调用 `server` 查询模块获取首屏数据，不需要绕行自身 HTTP API。客户端组件通过 API 创建研究、轮询结果、导入、确认关联或删除记录。主要页面如下：

| 路径 | 作用 |
| --- | --- |
| `/` | 首页及研究记录入口 |
| `/research`、`/research/[id]` | 研究创建、历史、来源覆盖、逐步结果和恢复操作 |
| `/events` | 统一事件库与资料库，`tab=materials` 切换资料 |
| `/events/[id]` | 人工事件证据链、结论历史、截至某时回看 |
| `/events/automatic/[id]` | 自动事项详情，按关联研究切换区间快照 |
| `/import` | 粘贴资料、抽取预览、人工确认 |
| `/sources` | 来源状态、同步记录、待处理资料与管理操作 |

动态页面/接口使用 `force-dynamic`；研究状态接口返回 `Cache-Control: no-store`。详情客户端正常每 2 秒轮询，网络失败后指数退避至最多 30 秒并保留上次结果。当前没有 WebSocket 或 SSE 推送。[轮询实现](../src/app/research/ResearchClient.tsx)

### 3.2 研究进程

[scripts/research-worker.ts](../scripts/research-worker.ts) 持续调用 `workOnce()`，有工作时间隔 100ms，无任务时等待 1500ms，步骤异常后等待 5 秒。SIGTERM/SIGINT 停止后续循环；在途调用依靠请求超时、租约和提交前检查约束结果。

worker 直接访问同一 SQLite 文件，不通过 Web HTTP 服务执行任务。页面退出不会停止研究；仅启动 Web 时可以创建任务，但没有 worker 消费。

### 3.3 预设标的同步进程

[scripts/sync-loop.mjs](../scripts/sync-loop.mjs) 启动 `scripts/sync.ts`，每轮结束后等待 `SYNC_INTERVAL_MINUTES`，默认 30 分钟。它不是固定墙钟时刻的 cron。标的来自 `SYNC_CODES` 和人工事件关联的真实交易所代码，构造演示代码会被过滤。

同步复用人工入库链，按来源记录 `sync_runs`；每次来源同步最多分析 10 份最早的 pending 版本，失败版本留给显式重试。数据库旁的 `.sync.lock` 防止正常 API/脚本入口重叠，超过 30 分钟视为陈旧锁。该锁是本地文件协调，不是跨主机分布式锁。

### 3.4 外部接口

| 服务 | 接口/用途 | 数据边界 |
| --- | --- | --- |
| iFinD MCP | `search_notice` / `search_news` | 公告/资讯片段、语义检索；不能证明穷尽 |
| 扶摇 META MCP | `get_meta_tickers_search` | 核验唯一 A 股代码和名称 |
| 扶摇 REST | `/api/news/stock/timeline-list` | 新闻摘要、供应商游标分页 |
| 扶摇 A 股 MCP | `get_a_share_prices_snapshot` | 行情背景，不进入事件证据 |
| 可配置模型 | `AI_BASE_URL` 下的 `/chat/completions` | 论断抽取、相关性和关系建议 |

模型名称来自环境变量。接口兼容性不意味着运行时一定使用 OpenAI 服务。资料 URL 用于追溯展示；应用不自动执行链接、抓取任意 URL 或解析 PDF 全文。[研究适配器](../src/server/research/providers.ts) · [同步适配器](../src/server/sources/sync.ts)

## 4. 核心业务链路

### 4.1 按股票与区间自动研究

1. 客户端和服务器使用 `ResearchInput` 校验股票代码、有效日期、起止顺序和最多 366 个自然日；截止日期不能超过北京时间今天。
2. `POST /api/research` 使用 `Idempotency-Key` 创建任务，返回 202。相同 key 和兼容输入复用任务；不同输入冲突。没有 key 时服务器生成随机值。队列中 queued/running 总数上限为 20，这是全局积压限制，不是按用户限流。
3. 在同一事务创建 `research_jobs` 和三个 `research_source_runs`。iFinD 从逐日窗口开始，扶摇从 `first` 游标开始。
4. worker 在短事务内领取任务并设置租约。先解析标的，再交替执行抓取和单份资料分析，避免等待全部抓取完成才出现结果。
5. 抓取后按北京时间披露日复核：区间外排除；日期未知收录为 `unknown/excluded`，保留可查但不进入区间结论。
6. 分析先查 `(material_id, code, analysis_version)` 缓存；否则调用模型，再校验关联摘录、正文摘录、时间与归并锚点。有效结果与报告、事件索引在事务中一起提交。
7. 抓取和待分析资料处理后，按事项核验证据关系。关系结果依证据指纹复用；资料变动使旧指纹失效。
8. worker 生成最终报告，根据来源覆盖和失败情况写入 completed、partial 或 failed。前端持续读取数据库中的阶段性成果。

抓取预算默认扶摇 100 页、iFinD 每来源 64 次窗口请求；有效配置上限限制为 2000。iFinD 单窗口命中数量阈值为 20，可拆分多日窗口；初始就是单日窗口时只能提示可能截断。iFinD 完成可用窗口后仍标记覆盖受限。扶摇检查 `has_more` 与真实游标，重复或缺失游标不会被当成正常穷尽。

[任务存储](../src/server/research/store.ts) · [执行步骤](../src/server/research/worker.ts) · [输入规则](../src/domain/research.ts)

### 4.2 人工导入与确认

1. 粘贴正文和来源元数据，`importDocument()` 规范化 URL/供应商 ID；无外部标识时使用正文哈希作为身份。
2. 同一文档相同正文哈希判重复，正文变化创建新 `document_versions`，通过 `previous_version_id` 连成版本链。抓取时间只能由系统生成。
3. 模型抽取事件特征和论断，Zod 校验结构，`body.indexOf(quote)` 校验逐字引用；被拒绝论断保留原因。也可手工录入，仍须通过引用校验。
4. 匹配规则给出候选事件，不自动完成确认。用户选择新建/既有事件及支持、反驳、更正、替代关系。
5. `associate()` 在事务内写关联、标记论断 accepted 并重算结论。反驳/更正/替代必须指定同事件内的其他目标论断。
6. 撤销只写 `revoked_at`，保留历史行，并在同一事务重算结论。

自动同步产生的资料也走这条链路；自动抽取完成不等于已经成为人工确认事件。[入库服务](../src/server/ingest.ts) · [抽取校验](../src/server/ai.ts)

### 4.3 统一事件库与资料库

`libraryEvents()` 联合人工事件与自动索引。自动事项默认选最近更新的研究快照，详情允许切换研究；它不把多个区间的证据合成一个新的综合结论。关系未核验完成时向用户显示待核实。

跨研究合并 ID 来自股票、事件类型、原文对象锚点和期次锚点；锚点不完整时采用股票、资料 ID、事项序号保持独立。`indexResearch()` 在调用方事务内重建该研究的索引关系，确保报告 revision 与索引一致。

资料库直接联合 `research_materials` 和人工文档版本，不以“是否生成事件”为收录条件。待分析、失败、不相关或未知日期资料仍可查询。人工资料 ID 在联合结果中加 `manual:` 前缀。关注列表保存在浏览器本地，不是服务器用户账户订阅。

事件库页面每页 20 项，研究记录每页 10 项；研究详情资料按 offset 每次 20 项。API 的事件库 limit 可配置至 100。[查询实现](../src/server/library.ts) · [索引实现](../src/server/research/library-index.ts)

## 5. 证据与结论规则

四类论断为 `fact/opinion/speculation/rumor`；fact 表示可核验陈述，不保证已经证实。来源等级从监管 1、发行人 2、媒体 3，到研究/人工/行情 4、传闻 5。`isSubstantive()` 要求 fact 且 tier ≤3；等级用于规则与排序，不是真实性概率。

`computeConclusion()` 先过滤截至时刻不可见或已撤销证据，再处理更正、替代与明确有效期。单一命题无反证且有实质支持时为 supported；只有实质反证而无实质支持时为 denied；支持与反证并存时保留 conflicted，不仅凭来源等级消除反证。事件整体按冲突、失效及有效命题状态聚合。摘要由带 evidence IDs 的模板生成。

自动关系建议还必须满足：引用 ID 存在、摘录逐字一致、不能自引用、同一 from 只有一条关系、单位和统计口径相同、披露时间明确且方向正确、关系无环。少于两条证据无需模型核验；超过 80 条保留资料并标记关系待核实。

自动研究的单份分析正文上限为 40,000 字符，超出后保留原文并报错，不静默截断生成结论。关系未完成时即使内部已计算初稿，展示层仍会降级为初步摘录/待核实。

人工历史回看要求 `fetchedAt <= asOf`、`createdAt <= asOf` 且当时未撤销，防止后补资料泄漏到历史。发生时间和披露时间不能替代系统可知时间。UTC ISO 时间用于存储，研究披露日期按北京时间筛选；精度和未知值分别保留。自动研究按各自区间保存结果，不提供与人工链等价的完整历史结论版本库。

[结论规则](../src/domain/conclusion.ts) · [证据规则](../src/domain/evidence.ts) · [时间处理](../src/domain/time.ts) · [自动分析](../src/server/research/analysis.ts)

## 6. 数据模型

完整字段与约束以 [schema.sql](../src/server/schema.sql) 为准。以下列出所有 20 张业务表及关联职责，JSON 字段不是额外的物理表。

| 数据域 | 表 | 主键/重要约束与用途 |
| --- | --- | --- |
| 人工证据 | `sources` | id；来源类型、等级、接入状态、最后同步结果 |
| 人工证据 | `documents` | id；canonical_key 唯一；source_id 外键；可指向转载来源 |
| 人工证据 | `document_versions` | id；(document_id, content_hash) 唯一；正文、四类相关元数据、分析状态、上个版本 |
| 人工证据 | `claims` | id；version_id 外键；摘录、位置、分类、主体、时间、单位/口径、审核状态 |
| 人工证据 | `events` | id；事件主体与事项标识；current_conclusion_id 是应用维护指针，DDL 未声明该字段外键 |
| 人工证据 | `event_evidence` | id；event_id/claim_id/target_claim_id 外键；有效关联有部分唯一索引；撤销时间 |
| 人工证据 | `event_instruments` | (event_id, code)；直接/间接标的与理由，可引用论断 |
| 人工证据 | `conclusions` | id；event_id、previous_id 外键；状态、摘要/证据/冲突 JSON 和变更原因 |
| 同步 | `sync_runs` | id；source_id 外键；起止时间、状态、新增/重复数量、错误 |
| 自动研究 | `research_jobs` | id；request_key 唯一；股票、区间、状态、阶段、租约 token/期限 |
| 自动研究 | `research_source_runs` | (job_id, source_id)；来源状态及窗口/游标/预算 JSON；source_id 不引用人工 sources 表 |
| 自动研究 | `research_materials` | id；(provider_key, content_hash) 唯一；不可变内容快照、片段类型、来源时间 |
| 自动研究 | `research_documents` | (job_id, material_id)；研究与资料多对多、区间归属、分析结果/错误 |
| 自动研究 | `research_analysis_cache` | (material_id, code, analysis_version)；按股票与算法版本隔离的结果缓存 |
| 自动研究 | `research_reports` | job_id；最新报告 body、revision、generated_at；更新覆盖本行，不是每 revision 一行 |
| 自动研究 | `research_relations` | (job_id, group_id)；证据指纹、关系核验状态、结果/错误 |
| 自动研究 | `research_relation_leases` | (job_id, group_id)；记录关系步骤归属的任务租约 |
| 查询索引 | `library_events` | id；(code, merge_key) 唯一；跨研究自动事项身份 |
| 查询索引 | `library_event_research` | (event_id, job_id)；每研究事项快照和报告 revision |
| 查询索引 | `library_event_materials` | (event_id, job_id, material_id)；复合外键指向事项快照，关联删除级联 |

人工主链：`sources → documents → document_versions → claims → event_evidence → events`，结论和标的归属事件。自动主链：`research_jobs ↔ research_documents ↔ research_materials`，每个研究另有关联来源进度、报告、关系；自动索引把研究内的事项与资料连接起来。

研究内容哈希包含正文、标题、披露时间、发布方和 URL；旧链的版本哈希以正文为基础，两套去重身份不应混用。不可变资料可以被多个研究引用，缓存不会因研究区间不同而盲目重复分析。

数据库启动开启外键、WAL 和 5000ms busy timeout；`tx()` 使用 `BEGIN IMMEDIATE/COMMIT/ROLLBACK`。DDL 通过 `CREATE TABLE IF NOT EXISTS` 初始化，另有 `subject_hint` 的兼容列迁移，目前没有完整的迁移版本管理框架。[数据库入口](../src/server/db.ts)

## 7. 状态、并发与恢复

| 对象 | 状态或转换 | 保证 |
| --- | --- | --- |
| 任务 | queued → running → completed/partial/failed；queued/running 可取消 | 工作进程领取后逐步提交，状态与阶段分离 |
| 恢复 | partial/failed/cancelled → queued | 成功页和已有分析保留；失败来源/资料/关系重新处理 |
| 来源 | pending/running/exhausted/limited/failed/unavailable | 空结果、未配置、错误、预算停止分别表达 |
| 资料分析 | pending/done/failed/excluded | 未知披露日 excluded 不进入区间结论 |
| 关系核验 | pending/running/done/failed | 指纹失效或租约失效后不能假称结果有效 |

任务租约为 120 秒，worker 每 20 秒续约。领取时在短写事务内选择可用任务并分配随机 token；网络请求在事务外执行；提交前检查任务仍存在、running、token 相同且租约有效。`updateOwned()` 在 SQL 内再次约束所有权，防止旧 worker 在恢复、取消或删除之后写回。

**取消**仅停止 queued/running 的后续工作并清租约，保留结果，允许重试。**批量删除**则在事务中撤销执行权、删除所选研究及其派生关系，并清理不再被其他研究引用的自动事件、资料和缓存；共享内容及人工事件保留。已删除任务不能通过重试恢复。

普通重试不会增加检索预算。只有 `retry?coverage=continue` 对标记 continuable 的 limited 来源增加 allowance（当前为已请求数 +100）；这仍不保证穷尽。

租约是数据库写入隔离机制，不保证上游调用 exactly-once。进程在外部调用后、提交前退出时，恢复可能再次调用供应商或模型；缓存只能减少已成功提交的重复分析。[恢复与删除](../src/server/research/store.ts)

## 8. HTTP 接口与权限边界

| 方法与路径 | 行为 | 权限 |
| --- | --- | --- |
| `GET /api/health` | 本地 DB `select 1`，失败 503 | 公开 |
| `GET /api/events`、`GET /api/events/[id]` | 人工事件搜索、详情/回看 | 公开 |
| `GET /api/library/events`、`GET /api/library/events/[id]` | 联合事件列表、自动事项详情 | 公开 |
| `GET /api/library/materials` | 资料查询与关联追溯 | 公开 |
| `POST /api/research` | 创建任务，202 | 公开 |
| `GET /api/research/[id]`、`GET /api/research/[id]/report` | 任务进度与报告 | 公开 |
| `DELETE /api/research/[id]` | **取消**，保留任务和结果 | 公开 |
| `DELETE /api/research` | **批量永久删除**，body 为 `{ids:[...]}`，最多 100 个 UUID | 公开 |
| `POST /api/research/[id]/retry` | 恢复；可加 `coverage=continue` | 公开 |
| `POST /api/documents` | 旧链资料导入 | 公开 |
| `GET/POST /api/documents/[id]/analyze` | 最新版本预览/分析 | 公开 |
| `POST /api/documents/[id]/claims` | 手工论断 | 公开 |
| `POST /api/associations`、`DELETE /api/associations/[id]` | 人工关联/撤销 | 公开 |
| `GET /api/sources`、`GET /api/prices` | 来源/行情背景 | 公开 |
| `POST /api/sources/[id]/sync` | 单来源同步 | ADMIN_TOKEN |
| `POST /api/sources/analyze-pending` | 批量分析/重试旧链资料 | ADMIN_TOKEN |
| `POST /api/demo/reset` | 重置旧链演示数据，不清理研究表 | ADMIN_TOKEN |

`requireAdmin()` 比较 Bearer token，未配置返回 503，错误口令返回 401。该权限没有覆盖研究创建/取消/删除，也没有覆盖普通导入与逐份分析。当前数据和操作共享，无账户、租户隔离、按用户配额或通用请求限流。

API 通用入口使用 Zod 和请求文本大小检查；错误封装为状态码与错误代码。模型/数据源密钥仅在服务器环境读取。原文作为不可信数据进入模型提示，程序再校验引用与关系；这不等价于保证模型语义判断完全正确。[API 工具](../src/server/api.ts) · [全部路由](../src/app/api/)

## 9. 出站可靠性与可观测性

`fetchWithPolicy()` 默认单次 30 秒超时。429 按 Retry-After 最多重试 3 次；5xx/网络/超时按 1 秒、2 秒最多重试 2 次；其余 4xx 不重试。尝试记录包含状态和耗时并附于返回/错误对象，不是独立持久化指标平台。MCP 适配负责 JSON-RPC 响应与工具 payload 解析。[请求策略](../src/server/http.ts) · [MCP 适配](../src/server/sources/mcp.ts)

运行观测来自同步日志、`sync_runs`、研究来源状态/资料错误/关系错误、容器日志和健康接口。`/api/health` 不调用付费接口，也不证明 worker 正在运行或供应商可用。Compose 对 sync/research 关闭容器健康检查，因此需结合队列积压、更新时间与 worker 日志判断卡住原因。

| 症状 | 首先检查 |
| --- | --- |
| 任务长期 queued | worker 是否运行、与 Web 是否指向同一数据库 |
| 标的解析失败 | META URL、扶摇密钥、股票代码是否唯一 |
| partial 但分析全 done | 来源覆盖是否 limited/unavailable，关系是否 failed |
| 取消后仍短暂有外部调用 | 取消使提交失效，不承诺立即中断已发出的网络请求 |
| 事件库没有事项但有资料 | 日期未知、相关性不足、未分析/失败或未提取有效事项 |
| 数据库 busy | 并发写入、长事务、同步重叠和磁盘状态 |
| 页面正常但研究不推进 | 健康接口只检查 DB；查看 research 进程日志与租约 |

## 10. 部署、配置与数据运维

### 10.1 推荐的 Compose 拓扑

[compose.yaml](../compose.yaml) 启动同镜像的 web、sync、research 三个服务，挂载同一 `app-data:/app/data`，使用 `/app/data/app.db`。web 默认发布 `0.0.0.0:3000`，需要反向代理时通过 `BIND_HOST=127.0.0.1` 收紧绑定；仓库默认值本身不保证应用端口仅本机可达。

[Dockerfile](../Dockerfile) 基于 Node 24 slim 多阶段构建，以 node 用户运行；保留 node_modules、源码、脚本和种子，以便 TypeScript worker 经 tsx 执行。容器 restart 为 unless-stopped，日志按 10MB ×3 轮换。sync/research 等待 web 首次健康，但之后不由 Web 进程代管。

可选宿主机 Caddy 代理域名至 `127.0.0.1:3000`，它不在 Compose 服务列表中。Cloudflare 与线上域名属于已有部署记录，不能从本地 Caddyfile 推断实时 DNS/TLS 状态。[Caddy 配置](../deploy/Caddyfile) · [历史部署记录](caddy-deployment-2026-10-26.md)

直接运行时需同时守护 Web 与 research worker。`deploy/setup.sh` 安装 Web 和同步 timer，但尚未安装研究 worker 单元；不要重复启动 timer、cron 与 Compose 同步循环。

### 10.2 关键配置

| 配置 | 作用/默认 |
| --- | --- |
| `DATABASE_PATH` | 默认 `./data/app.db`；三个进程必须指向同一文件 |
| `BACKUP_DIR` | CLI 默认 `./backups`；Compose 配为 `/app/data/backups` |
| `ADMIN_TOKEN` | 指定管理 API；缺失时管理操作禁用 |
| `AI_BASE_URL/AI_MODEL/AI_API_KEY` | 模型抽取与关系核验 |
| `FUYAO_API_KEY/FUYAO_MCP_META_URL` | 自动研究标的核验必需 |
| `FUYAO_BASE_URL` | 扶摇新闻；研究配置检查要求该值非空 |
| `FUYAO_MCP_A_SHARE_URL` | 行情背景接口 |
| `IFIND_TOKEN/IFIND_MCP_URL` | 公告与资讯来源 |
| `SYNC_CODES/SYNC_INTERVAL_MINUTES` | 旧链预设标的和同步间隔，默认 30 分钟 |
| `RESEARCH_MAX_NEWS_PAGES/RESEARCH_MAX_SEARCH_WINDOWS` | 研究每来源预算，默认 100/64 |
| `BIND_HOST/PORT` | Compose 宿主绑定，默认 `0.0.0.0/3000` |

凭证保存在本机 `.env`，不写入文档、Git 或镜像。具体安装步骤见 [Docker 安装](docker-install.md)。

### 10.3 备份、迁移与回填

`npm run backup` 使用 `node:sqlite.backup()` 生成包含已提交 WAL 内容的一致性备份，并执行 `PRAGMA integrity_check`。默认目录权限 0700、备份文件 0600。Compose 中备份在同一数据卷内，因此它本身不是异机灾备；自动调度、异机复制和保留策略未在当前 Compose 配置实现。

恢复应先停止所有数据库写入进程，按部署文档处理数据库与 WAL/SHM 文件，再重启验证；不要用直接复制运行中的主 `.db` 文件替代在线备份。更新不应删除持久化卷。

旧研究进入统一库可运行 `npm run library:backfill -- --dry-run` 后执行回填。它按任务重建索引，不重新抓取、不调用模型、不修改人工证据与原报告；应先对备份副本演练。脚本并非自动迁移框架。[备份脚本](../scripts/backup.ts) · [回填实现](../src/server/research/library-index.ts)

## 11. 质量验证与架构取舍

测试结构来自 [Vitest 配置](../vitest.config.ts) 与 [Playwright 配置](../playwright.config.ts)：

| 层级 | 关注内容 | 命令 |
| --- | --- | --- |
| 单元 | 时间、证据规则、结论、匹配、AI 校验、HTTP、连接器 | `npm test` |
| 集成 | SQLite、入库、同步、研究租约/恢复/删除、索引和共享资料保留 | `npm test` |
| 静态/构建 | 类型与生产编译 | `npm run typecheck`、`npm run build` |
| 浏览器 | 导入确认、研究渐进结果、事件资料库、取消/删除、断线恢复 | 构建后 `npm run test:e2e` |

浏览器回归默认使用端口 3100 的隔离测试服务器，供应商/模型夹具不能证明真实服务覆盖。历史测试结果见 [测试说明](testing.md) 与 [最近验收](library-fix-2026-10-26.md)。本次仅新增架构文档及图示，未重新执行应用测试或线上验收；图示验证记录与应用功能验证独立。

| 当前选择 | 获益 | 代价/边界 |
| --- | --- | --- |
| 单仓库 Next.js + 三进程 | 复用类型与领域规则，部署简单 | 运行配置和数据库路径必须一致 |
| SQLite 兼任队列与存储 | 无额外基础设施，事务内可原子提交 | 单文件写入串行；不等价于跨主机高可用队列 |
| 短步骤 + token 租约 | 页面退出/进程故障后可恢复，隔离迟到结果 | 不能保证外部调用只执行一次 |
| 人工/自动表分离 | 审核语义稳定、演示重置不污染研究 | 查询联合与生命周期清理更复杂 |
| 报告 + 读索引同事务更新 | 可逐步浏览、快照一致 | 增加写入量；并非完整报告版本存档 |
| 模型建议 + 硬校验 + 规则结论 | 原文可追溯、状态可测试 | 引用合法仍可能语义误判，需人工复核 |

已知扩展压力包括同步 SQLite 对事件循环的阻塞、事件库读取时逐个重算人工结论、资料查询的 LIKE/联合查询和多次关联读取、没有用户隔离与限流、没有自动化 worker 健康监控和异机备份。当前没有负载结果可据以宣称容量。

未来若转为多人生产系统，应先明确权限/配额和备份恢复目标，再根据实际负载评估数据库与队列拆分；全文/PDF 获取、持续订阅、完整报告版本比较、人工纠错审计均属于后续能力，架构图未把它们画成已实现组件。

## 12. 图示维护与复现

本次 Archify 的源码验证、交付、严格结构检查和真实浏览器自动检查均已通过；未进行截图视觉审阅。最终记录为 [验证摘要](architecture/review-4/architecture.finalize-summary.json) 和 [浏览器检查](architecture/review-4/architecture.browser-check.json)。此前记录保留了浏览器环境修复过程，以 review-4 为最终结果。

图中的源代码引用固定在上述 Git revision，节点可追溯到具体路径和行号。基线业务源码没有未提交修改；编写前工作区已有未跟踪 `.agents/skills/archify/` 与 `.impeccable/`，均不作为该 revision 的业务证据，本次保留它们。

在仓库根目录、Node 24 环境运行：

```bash
node .agents/skills/archify/bin/archify.mjs finalize architecture \
  docs/architecture/candidate.json docs/architecture/architecture.html \
  --repo-root . --quality showcase --json
```

修改图源后重新验证；同一路径已有浏览器证据时，追加新的 `--out-dir docs/architecture/review-N` 保留证据归属。工具包随仓库保存在 `.agents/skills/archify/`；复现需要 Node.js 和可用的 Chromium（必要时通过 `ARCHIFY_CHROME` 指定路径）。生成的 HTML 可以独立打开。

后续维护顺序：核对代码基线 → 更新本文和候选图源 → 校对源代码范围 → 重新 finalize。不要只改渲染 HTML，也不要把报告计划中的能力写成已部署事实。
