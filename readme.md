# 投资事件情报与证据时间线

输入 A 股代码和披露日期范围，自动检索真实公告与新闻，逐步整理事项、原文摘录和证据冲突；也支持人工导入及事件历史回看。

测试入口：[股票区间研究](https://timeline.tianyubai.cn/research) · [事件库](https://timeline.tianyubai.cn/events) · [资料库](https://timeline.tianyubai.cn/events?tab=materials)。最新功能、回填及部署验收见 [统一事件库与批量清除记录](docs/library-fix-2026-10-26.md)。

发布镜像：[zht7063/investment-event-timeline](https://hub.docker.com/r/zht7063/investment-event-timeline)，提供 `latest` 和固定版本 `git-efaa6d6`，平台为 `linux/amd64`。

## 快速启动

```bash
# 环境要求：Node 24+
touch .env          # 按下文环境变量表填写模型、数据源凭证和 ADMIN_TOKEN
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

`.env` 不提交到仓库，也不打入镜像。本机若已有 `.local.env`，可复制为 `.env`；该本地配置文件不随仓库发布。

## 按股票与时间范围自动研究

访问 `/research`，输入 A 股代码（支持六位代码及交易所后缀）和起止披露日期，即可创建后台研究任务。不必把股票加入 `SYNC_CODES`，也不必人工逐条确认才能看到分析。

- 任务自动解析公司名称、抓取公告/新闻、按北京时间再次过滤日期，逐步展示事件、论断摘录及冲突。
- iFinD 是片段语义检索，不能保证穷尽；扶摇按真实游标翻页。每来源显示覆盖、预算停止和错误，未完成关系核验的事件显示初步结果。
- 刷新或关闭网页不影响后台处理。取消保留已收录资料；重试恢复失败页、待分析资料及失败的关系核验。
- “N 份资料 · M 份已分析”分别表示已收录资料和已完成资料分析的数量，后续还可能进行证据关系核验。“部分完成”可能是来源覆盖受限，须结合来源状态判断，不等于模型分析失败；只有“继续检索更多资料”才扩大检索预算。
- 研究资料收录后即可在事件库的“资料”页签查询，已提取事项自动进入“事件”页签，无需等待研究完成。自动事项保留独立标识，不覆盖人工确认，不受演示重置影响。跨研究按明确对象和期次去重，各区间报告仍分别保留；日期未知资料单列。
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

## 事件库与研究记录管理

### 事件与资料

`/events` 提供“事件”和“资料”两个页签，共享股票代码、公司名称、关键词、来源类型和关注标的筛选，每页 20 项。

- **收录即可查询**：待分析、分析失败、日期不明或未提取出事项的资料均保留在资料页签，研究未完成也能查看。
- **逐份生成事项**：有效事项随分析逐步进入事件库，显示“自动提取／未经人工确认”；关系核验完成前显示待核实，并区分等待核验、核验中和核验失败。
- **跨研究去重**：按明确的股票、事项对象和报告期归并；锚点不足时保持独立。自动事项不覆盖人工确认事件。
- **保留区间边界**：同一自动事项可切换相关研究，默认展示最近更新的研究结果；各研究的证据和结论分别保存，不合成跨报告综合结论。
- **可追溯资料**：展开资料查看收录文本、来源、关联事项和研究记录；同一资料版本不因重复研究而重复展示，分析状态按股票区分。

### 取消与删除研究

首页与 `/research` 共用研究记录列表，每页 10 项。

- 研究详情中的“停止后续处理”是**取消任务**：停止后续处理，保留已有资料与事项，之后可重试。
- 列表中的“清除”是**批量删除入口**：点击后显示本页复选框；未选中时按钮显示“取消”，选中后显示“删除”，点击即删除所选记录。
- 删除会停止对应任务，移除其报告以及仅由这些记录引用的事件、资料和分析缓存；其他研究共享的内容及人工事件保留。迟到的后台结果不能重新写回。
- 删除失败时保留勾选，可刷新核对或重试；切换页码会取消选择。删除不是取消任务，不能通过“重试未完成部分”恢复已删除记录。

## 产品能力

- **事件跟踪**：识别、合并、跟踪同一事件的不同来源与版本
- **论断分类**：事实、观点、推测、传闻，各有来源等级和权重
- **四类时间**：发生、披露、抓取、来源更新分别存储和展示
- **证据冲突**：支持与反驳同时保留，不单凭等级抹掉反证
- **结论变化**：更新、否认、更正、过期均改变结论，有版本历史
- **截至某时**：人工事件支持历史回看，后补资料不泄漏到早期；自动事项按研究区间分别查看
- **关联标的**：本地关注清单，行情背景（不作证据）
- **预设标的同步**：iFinD 公告/新闻、扶摇个股新闻，定时同步和手动触发；来源页可用管理口令批量分析、重试失败资料。此流程的分析结果需人工确认归并；按需研究的自动事项则逐步进入事件库
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
scripts/backfill-library.ts # 既有研究结果回填到统一事件库
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

### Docker Hub + Compose（推荐）

在项目目录准备 `.env` 后，拉取已发布镜像，无需在服务器编译。**已有部署先备份数据库和旧镜像**，步骤见 [Docker 安装与更新](docs/docker-install.md)。

```bash
touch .env   # 填写模型、数据源凭证和 ADMIN_TOKEN
chmod 600 .env
docker pull zht7063/investment-event-timeline:git-efaa6d6
docker image tag zht7063/investment-event-timeline:git-efaa6d6 evt-timeline:local
docker compose up -d --no-build
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

固定版本标签便于复现；也可使用 `latest` 获取最近发布版本。镜像不包含运行凭证或真实研究数据库。

需要自行构建时，在同一项目目录执行 `docker compose up -d --build`。Compose 同时运行 `web` 网页、`sync` 预设标的同步和 `research` 按需研究服务，共享 `evt-timeline_app-data` 数据卷，默认端口 3000。按需研究不要求配置 `SYNC_CODES`。

从旧版升级到统一事件库时，需要对已有研究执行一次回填。先在数据库备份副本演练，再按 [回填部署步骤](docs/docker-install.md#研究资料与统一事件库回填) 暂停服务、执行预览和回填、恢复服务：

```bash
# 仅对备份副本演练，不替换在线数据库
DATABASE_PATH=/tmp/rehearsal.db npm run library:backfill -- --dry-run
DATABASE_PATH=/tmp/rehearsal.db npm run library:backfill
```

回填可重复执行，不重新抓取、不调用模型，也不改写原区间报告和人工证据。已删除的研究不会通过回填恢复。

安装、更新、备份恢复、日志和域名接入见 [Docker 安装说明](docs/docker-install.md)。不要与旧 cron/systemd 同步任务同时运行，也不要通过 `docker compose down -v` 更新服务，该命令会删除数据卷。

## 验证结果

截至 2026-10-26，包含统一事件库和研究记录批量删除的版本已完成：

| 验证 | 结果 |
| --- | --- |
| 单元／集成测试 | 110 项通过，最终 Docker 镜像运行时同样通过 |
| 类型检查与生产构建 | 通过 |
| 本机生产服务浏览器回归 | 18 项通过，使用隔离数据库及数据源／模型夹具 |
| 统一事件库上线冒烟 | 7 项通过；桌面、手机和资料追溯检查通过 |
| 批量删除上线交互检查 | 选择、取消与按钮切换通过；未删除真实研究记录 |
| 历史回填 | 备份副本与线上回填通过，重复执行不增加重复事项，原始数据校验一致 |
| Docker Hub 发布 | `git-efaa6d6` 与 `latest` 已上传并拉取校验，镜像一致 |

验证时 `002230.SZ` 的已取消研究仍可查 81 份资料、53 个事项，证明取消或未完成研究不妨碍已有成果入库。该数量是验收时的记录，不代表当前实时数据或全网覆盖。测试详情及回滚信息见 [最新验收记录](docs/library-fix-2026-10-26.md)；此前两只股票的真实供应商验收见 [研究部署记录](docs/research-deployment-2026-10-26.md)。

## 已知边界

- 单实例部署，无访客隔离和请求限流
- 当前公开实例允许访客导入、创建、取消和删除共享研究任务，尚无用户权限隔离；`ADMIN_TOKEN` 不保护研究记录的创建与删除。演示重置只清理旧版事件/导入资料，不清理研究任务与研究资料
- 不做全市场资讯平台、用户系统、持仓管理、交易或投资建议
- 不预测涨跌，不给出买卖建议
- 来源等级只用于排序和规则，不换算成真实性概率
- 本地完整 Playwright 回归使用临时数据库和供应商/模型夹具，覆盖旧版流程，以及研究创建、逐步结果、资料库筛选与分页、取消、批量删除和断线恢复；不能据此证明真实数据源覆盖。运行前需 `npm run build`，并安装浏览器：`npx playwright install chromium`

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
- [统一事件库、批量清除及最新验收](docs/library-fix-2026-10-26.md)
- [Docker 安装、回填与 Docker Hub 镜像](docs/docker-install.md)
- [Caddy 域名部署与验收](docs/caddy-deployment-2026-10-26.md)

测试入口为 `https://timeline.tianyubai.cn`，由 Cloudflare 转发至宿主机 Caddy，再代理到 `127.0.0.1:3000`；应用端口仅本机可访问。配置及验证步骤见 [Caddy 域名接入](docs/docker-install.md#绑定-timelinetianyubaicn-caddy-https)。早期演示版的历史发布情况见 [演示版发布记录](docs/release-readiness.md)；当前验证结果以上表及最新验收记录为准。

## 未做事项

以下是实施计划中提到但本次未实现或部分实现的内容：

- 访客会话隔离、请求限流、模型调用配额：演示版按用户决定不实施，保留访客公开导入和分析
- 模型润色结论摘要：仅使用模板生成，未接入模型润色
- 官方公告完整列表与正文/PDF、新闻全文核验
- 持续订阅、增量刷新、完整跨报告版本比较和人工纠错审计
- 全市场、全年历史及真实供应商配额耗尽验收：当前已验证两只股票、有限日期区间和真实游标翻页，不代表大规模覆盖
- 负载测试、无障碍自动化测试
- 演示视频
