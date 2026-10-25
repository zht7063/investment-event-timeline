# 投资事件情报与证据时间线

围绕一个投资事件，查清最初来源、事实变化、证据冲突、当前结论及关联标的。

## 快速启动

```bash
# 环境要求：Node 24+
cp .local.env .env   # 编辑 .env 填写必要变量
npm ci
npm run build
npm start            # http://localhost:3000
```

首次启动自动加载构造演示数据（虚拟公司事件链）。重置演示数据：

```bash
curl -X POST http://localhost:3000/api/demo/reset -H "Authorization: Bearer <ADMIN_TOKEN>"
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_PATH` | 否 | SQLite 文件路径，默认 `./data/app.db` |
| `ADMIN_TOKEN` | 是 | 管理口令（同步、重置） |
| `AI_BASE_URL` | 是 | OpenAI 兼容接口 `/v1` |
| `AI_MODEL` | 是 | 模型名称，需支持 JSON 结构化输出 |
| `AI_API_KEY` | 是 | 模型 API Key |
| `FUYAO_API_KEY` | 否 | 扶摇 API Key（行情背景、新闻同步） |
| `FUYAO_BASE_URL` | 否 | 扶摇 REST 主机 |
| `FUYAO_MCP_A_SHARE_URL` | 否 | 扶摇 A 股 MCP 端点 |
| `IFIND_TOKEN` | 否 | iFinD MCP 密钥 |
| `IFIND_MCP_URL` | 否 | iFinD 资讯 MCP 端点 |
| `SYNC_CODES` | 否 | 同步标的代码（逗号分隔，如 `300308.SZ,600519.SH`）；种子数据 DEMO-* 不会被同步 |

模板见 `.local.env`。

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
data/seed/         # 构造演示数据
deploy/            # systemd 服务和部署脚本
docs/              # 计划、AI 记录、测试说明
```

## AI 的角色

模型只做论断抽取、分类建议、归并候选与理由。引用校验、关联提交和状态计算由应用规则完成。模型失败时资料保留为"待分析"，可重试或人工录入。资料原文只作数据传入，不改变系统指令。

详见 `docs/ai-usage.md`。

## 数据来源

| 来源 | 接入方式 | 备注 |
| --- | --- | --- |
| 构造演示数据 | 种子加载 | 虚拟公司，显式标注 |
| iFinD 公告/新闻 | MCP search_notice/search_news | 片段，无全文，日精度。已对 `300308.SZ` [真实验证](docs/api-test-report-2026-10-25.md)（用户本机） |
| 扶摇个股新闻 | REST API | MCP news 端点 405，改用 REST。已对 `300308.SZ` [真实验证](docs/api-test-report-2026-10-25.md)（用户本机） |
| 扶摇行情 | MCP get_a_share_prices_snapshot | 仅背景，不作证据。已对 `300308.SZ` [真实验证](docs/api-test-report-2026-10-25.md)（用户本机） |
| 人工导入 | 粘贴文本 | 不抓取 URL |

## 部署

### 直接运行（推荐）

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
测试机旧部署目前仍使用 cron，本次新脚本尚未安装。上线核对和回滚步骤见 `docs/release-readiness.md`。

### Docker（配置已补齐，尚未实测镜像）

```bash
docker build -t evt-timeline .
docker run -d --name evt -p 3000:3000 -v evt-data:/app/data --env-file .env evt-timeline
```

## 已知边界

- 单实例部署，无访客隔离和请求限流
- 公开实例允许访客导入，被污染时由管理员一键重置
- 不做全市场资讯平台、用户系统、持仓管理、交易或投资建议
- 不预测涨跌，不给出买卖建议
- 来源等级只用于排序和规则，不换算成真实性概率
- Playwright 使用临时数据库和本地模型替身，覆盖页面冒烟、导入→分析→归并→历史回看→撤销、待分析入口与管理员批量分析；运行前需 `npm run build`，并安装浏览器：`npx playwright install chromium`

## 文档

- [实施计划](docs/implementation-plan.md)
- [AI 使用与验证记录](docs/ai-usage.md)
- [测试说明](docs/testing.md)
- [数据探测结果](docs/data-probe.md)
- [已知缺陷与修复记录](docs/known-bugs.md)
- [真实 API 测试报告](docs/api-test-report-2026-10-25.md)

测试机已部署并完成真实同步，本轮只读复核正常；本次代码修复尚未发布。当前部署状态、演示版边界与片段证据说明见 [上线前收尾清单](docs/release-readiness.md)。

## 未做事项

以下是实施计划中提到但本次未实现或部分实现的内容：

- 访客会话隔离、请求限流、模型调用配额：演示版按用户决定不实施，保留访客公开导入和分析
- 模型润色结论摘要：仅使用模板生成，未接入模型润色
- 多标的同步验证：真实 API 仅覆盖 `300308.SZ`，多标的、分页、限流场景未验证
- 负载测试、无障碍自动化测试
- 演示视频
