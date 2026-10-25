# 投资事件情报与证据时间线

输入 A 股代码和披露日期范围，自动检索真实公告与新闻，逐步整理事项、原文摘录和证据冲突；也支持人工导入及事件历史回看。

测试入口：[股票区间研究](http://185.115.207.143:3000/research)。当前部署与真实验收见 [2026-10-26 部署记录](docs/research-deployment-2026-10-26.md)。

## 快速启动

```bash
# 环境要求：Node 24+
cp .local.env .env   # 编辑 .env 填写必要变量
npm ci
npm run build
npm start            # http://localhost:3000
```

股票研究还需要在另一个终端、同一项目目录运行 `npm run research:worker`；只启动网页时，任务会留在队列中。运行配置见下文，Docker Compose 会一并启动 worker。

首次启动自动加载构造演示数据（虚拟公司事件链）。重置演示数据：

```bash
curl -X POST http://localhost:3000/api/demo/reset -H "Authorization: Bearer <ADMIN_TOKEN>"
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_PATH` | 否 | SQLite 文件路径，默认 `./data/app.db` |
| `ADMIN_TOKEN` | 是 | 管理口令（同步、旧资料批量分析/重试、演示重置） |
| `AI_BASE_URL` | 是 | OpenAI 兼容接口 `/v1` |
| `AI_MODEL` | 是 | 模型名称，需支持 JSON 结构化输出；当前测试部署为 `deepseek-flash`，可通过配置更换 |
| `AI_API_KEY` | 是 | 模型 API Key |
| `FUYAO_API_KEY` | 股票研究必填 | 扶摇 API Key（标的核验、行情背景、新闻） |
| `FUYAO_MCP_META_URL` | 股票研究必填 | 标的代码及公司名称核验端点 |
| `FUYAO_BASE_URL` | 否 | 扶摇 REST 主机 |
| `FUYAO_MCP_A_SHARE_URL` | 否 | 扶摇 A 股 MCP 端点 |
| `IFIND_TOKEN` | 否 | iFinD MCP 密钥 |
| `IFIND_MCP_URL` | 否 | iFinD 资讯 MCP 端点 |
| `SYNC_CODES` | 否 | 同步标的代码（逗号分隔，如 `300308.SZ,600519.SH`）；种子数据 DEMO-* 不会被同步 |
| `RESEARCH_MAX_NEWS_PAGES` | 否 | 每次研究的扶摇抓取预算，默认 100 页 |
| `RESEARCH_MAX_SEARCH_WINDOWS` | 否 | 每次研究的 iFinD 每来源检索预算，默认 64 个日窗口 |

模板见 `.local.env`。

## 按股票与时间范围自动研究

访问 `/research`，输入 A 股代码（支持六位代码及交易所后缀）和起止披露日期，即可创建后台研究任务。不必把股票加入 `SYNC_CODES`，也不必人工逐条确认才能看到分析。

- 任务自动解析公司名称、抓取公告/新闻、按北京时间再次过滤日期，逐步展示事件、论断摘录及冲突。
- iFinD 是片段语义检索，不能保证穷尽；扶摇按真实游标翻页。每来源显示覆盖、预算停止和错误，未完成关系核验的事件显示初步结果。
- 刷新或关闭网页不影响后台处理。取消保留已收录资料；重试恢复失败页、待分析资料及失败的关系核验。
- “N 份资料 · M 份已分析”分别表示已收录资料和已完成资料分析的数量，后续还可能进行证据关系核验。“部分完成”可能是来源覆盖受限，须结合来源状态判断，不等于模型分析失败；只有“继续检索更多资料”才扩大检索预算。
- 研究资料使用独立不可变快照，不写入旧版人工审核事件库，不受演示重置影响。区间报告只使用本任务区间内资料；日期未知单列。
- 当前任务共享可见，沿用演示版公开操作边界；不是多用户私密投研系统。未自动抓取全文或执行任意来源链接。

Docker Compose 已包含 `research` worker，共享持久化数据库。直接运行时，除网页进程外，另开持久进程：

```bash
npm run research:worker
```

必需配置：`FUYAO_API_KEY`、`FUYAO_MCP_META_URL`（标的核验）、模型三个变量；资讯来源分别使用已有 iFinD 和扶摇配置。`RESEARCH_MAX_NEWS_PAGES` 默认100，`RESEARCH_MAX_SEARCH_WINDOWS` 默认64；预算耗尽不是检索穷尽。单次日期跨度最多366个自然日。

只读数据探测（不写数据库、不调用模型）：

```bash
npm run research:probe -- 300308.SZ 2026-09-01 2026-09-07
```

实施方案见 [股票区间研究方案](docs/stock-research-plan.md)，真实数据边界见 [能力验证](docs/research-capabilities.md)。后续持续订阅、报告历史比较、生产权限和预算管理另行实施。

## 产品能力

- **事件跟踪**：识别、合并、跟踪同一事件的不同来源与版本
- **论断分类**：事实、观点、推测、传闻，各有来源等级和权重
- **四类时间**：发生、披露、抓取、来源更新分别存储和展示
- **证据冲突**：支持与反驳同时保留，不单凭等级抹掉反证
- **结论变化**：更新、否认、更正、过期均改变结论，有版本历史
- **截至某时**：回看过去任一时点的结论，后补资料不泄漏到早期
- **关联标的**：本地关注清单，行情背景（不作证据）
- **数据同步**：iFinD 公告/新闻、扶摇个股新闻，定时同步和手动触发；来源页可用管理口令批量分析、重试失败资料。已分析资料需确认归并才进入事件列表
- **导入**：人工粘贴文本，模型抽取论断并校验原文引用

## 技术栈

- TypeScript + Next.js 16 App Router（页面与 API 同一项目）
- SQLite（Node 内置 `node:sqlite`），手写 `schema.sql`
- Zod 4 校验 API 输入和模型输出
- Vitest 5 测试；普通 CSS，无组件库

## 项目结构

```
src/
  app/             # 页面和 API 路由
  components/      # 共享组件
  domain/          # 领域规则（纯函数）
  server/          # 数据库、入库、AI、HTTP、数据源连接器
scripts/sync.ts    # 同步脚本（cron）
scripts/research-worker.ts # 持久化研究任务 worker
data/seed/         # 构造演示数据
deploy/            # systemd 服务和部署脚本
docs/              # 计划、AI 记录、测试说明
```

## AI 的角色

截至 2026-10-26，测试部署的 `AI_MODEL` 为 `deepseek-flash`。模型通过配置的兼容接口调用，模型名称不写死在代码中。

- 模型负责资料相关性判断、多事项与论断抽取，以及证据之间支持、反驳、更正和替代关系的建议。
- 程序负责资料抓取、去重、日期过滤、原文摘录及引用校验、保守归并和最终结论状态计算。报告使用可追溯引用，不由模型自由润色事实性摘要。
- 资料分析失败时保留原资料并显示失败状态，可重试；关系核验失败时保留摘录并标记待核实。自动结果不冒充人工确认，片段分析不冒充全文核验。

资料原文只作数据传入，不改变系统指令。

详见 `docs/ai-usage.md`。

## 数据来源

| 来源 | 接入方式 | 备注 |
| --- | --- | --- |
| 构造演示数据 | 种子加载 | 虚拟公司，显式标注 |
| iFinD 公告/新闻 | MCP search_notice/search_news | 片段，无全文，日精度；语义检索不保证穷尽，日期须本地复核。两只股票的线上真实验收见 [部署记录](docs/research-deployment-2026-10-26.md) |
| 扶摇个股新闻 | REST API | 按真实游标翻页，主要为摘要，无日期参数；两只股票及翻页能力见 [能力验证](docs/research-capabilities.md) 与 [线上验收](docs/research-deployment-2026-10-26.md) |
| 扶摇行情 | MCP get_a_share_prices_snapshot | 仅背景，不作证据。已对 `300308.SZ` [真实验证](docs/api-test-report-2026-10-25.md)（用户本机） |
| 人工导入 | 粘贴文本 | 不抓取 URL |

## 部署

### 直接运行

```bash
npm ci
npm run build
npm start

# 或安装用户 systemd 服务及同步 timer（以服务所属用户执行，不加 sudo）
# 从旧 cron 升级时，先移除本项目的旧同步条目，避免重复调度。
bash deploy/setup.sh /absolute/path/to/project
# 可配置 PORT、BIND_HOST、SYNC_INTERVAL_MINUTES（默认 3000、0.0.0.0、30）
# 如需退出登录后持续运行，由服务器管理员启用该用户的 linger。

# 在线一致性备份（包含 WAL 中已提交的数据）
npm run backup
```

部署脚本生成 `systemd --user` 单元，并使用 timer 定时同步；日志由 journal 管理。
该脚本尚未安装研究 worker 的守护服务，直接部署时需额外守护 `npm run research:worker`，并使用与网页相同的工作目录、配置和数据库。
本次测试服务器使用 Docker Compose；systemd 脚本保留为直接运行的备选方式。

### Docker Compose（推荐）

```bash
cp .local.env .env   # 填写模型、数据源凭证和 ADMIN_TOKEN
chmod 600 .env
docker compose up -d --build
docker compose ps
```

Compose 同时运行 `web` 网页、`sync` 预设标的同步和 `research` 按需研究服务，共享持久化数据库；默认端口 3000。当前测试部署采用本机构建、服务器加载镜像的方式，避免在小内存服务器执行生产编译。
安装、更新、备份恢复、日志和后续域名接入见 [Docker 安装说明](docs/docker-install.md)。
不要与旧 cron/systemd 同步任务同时运行。

## 已知边界

- 单实例部署，无访客隔离和请求限流
- 公开实例允许访客导入和创建研究任务；演示重置只清理旧版事件/导入资料，不清理研究任务与研究资料
- 不做全市场资讯平台、用户系统、持仓管理、交易或投资建议
- 不预测涨跌，不给出买卖建议
- 来源等级只用于排序和规则，不换算成真实性概率
- 本地完整 Playwright 回归使用临时数据库和供应商/模型夹具，覆盖旧版流程，以及研究创建、逐步结果、已有资料后刷新、取消和断线恢复；不能据此证明真实数据源覆盖。运行前需 `npm run build`，并安装浏览器：`npx playwright install chromium`

## 文档

- [实施计划](docs/implementation-plan.md)
- [AI 使用与验证记录](docs/ai-usage.md)
- [测试说明](docs/testing.md)
- [数据探测结果](docs/data-probe.md)
- [已知缺陷与修复记录](docs/known-bugs.md)
- [真实 API 测试报告](docs/api-test-report-2026-10-25.md)
- [股票区间研究方案](docs/stock-research-plan.md)
- [来源能力与限制](docs/research-capabilities.md)
- [研究实现与验收](docs/research-acceptance.md)
- [新测试服务器部署与真实验收](docs/research-deployment-2026-10-26.md)

当前测试服务器直接提供 3000 端口，未使用旧演示部署的 Caddy 入口。本轮 97 项单元/集成测试、最终 Docker 镜像的 13 项浏览器回归通过；线上两只股票共 19 份资料完成分析、40 条摘录核验通过，并验证重启、重试、取消和备份恢复。旧版历史见 [演示版发布记录](docs/release-readiness.md)。

## 未做事项

以下是实施计划中提到但本次未实现或部分实现的内容：

- 访客会话隔离、请求限流、模型调用配额：演示版按用户决定不实施，保留访客公开导入和分析
- 模型润色结论摘要：仅使用模板生成，未接入模型润色
- 官方公告完整列表与正文/PDF、新闻全文核验
- 持续订阅、增量刷新、完整跨报告版本比较和人工纠错审计
- 全市场、全年历史及真实供应商配额耗尽验收：当前已验证两只股票、有限日期区间和真实游标翻页，不代表大规模覆盖
- 负载测试、无障碍自动化测试
- 演示视频
