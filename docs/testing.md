# 测试说明

## 运行命令

```bash
# 单元测试和集成测试（无真实 API 调用，使用内存 SQLite）
npm test

# 类型检查
npm run typecheck

# 生产构建（含 TypeScript 校验）
npm run build
```

```bash
# Playwright 端到端冒烟测试（需先构建 + 安装浏览器）
# npx playwright install --with-deps chromium
npm run test:e2e
```

## 测试结果（2026-10-25）

| 类别 | 文件 | 覆盖内容 | 状态 |
| --- | --- | --- | --- |
| Unit | tests/unit/conclusion.test.ts | 结论引擎规则 | Pass |
| Unit | tests/unit/matching.test.ts | 去重、候选打分 | Pass |
| Unit | tests/unit/time.test.ts | 时间解析与格式化 | Pass |
| Unit | tests/unit/ai.test.ts | 抽取校验、引用检查、模型 JSON 解析 | Pass |
| Unit | tests/unit/http.test.ts | 重试策略（429、5xx、超时、400/401/403） | Pass |
| Unit | tests/unit/connectors.test.ts | 扶摇行情解析、业务错误、iFinD 新闻解包、字段映射 | Pass |
| Integration | tests/integration/seed.test.ts | 种子数据加载、结论历史回放 | Pass |
| Integration | tests/integration/ingest.test.ts | 导入、去重、分析、关联、撤销、重算、单位口径隔离 | Pass |
| Integration | tests/integration/sync.test.ts | Provider 注册、同步代码、去重、上游失败、pending 消化、锁 | Pass |
| Integration | tests/integration/release.test.ts | 批量鉴权/参数/上限/重试、积压优先与提示、行情端点 | Pass |
| Integration | tests/integration/db.test.ts | 旧库升级、重复打开、资料保留与完整性 | Pass |
| Build | `npm run build` | 18 路由（含 _not-found）、保留 TypeScript 校验 | Pass |
| Typecheck | `npm run typecheck` | 0 错误 | Pass |
| Playwright | tests/e2e/smoke.test.ts | health、首页、事件详情、数据源、导入、实际筛选按钮、手机宽度 | Pass (7/7) |
| Playwright | tests/e2e/workflow.test.ts | 导入→模型分析→归并→精确历史回看→撤销、来源页待分析入口、管理员批量分析 | Pass (3/3) |

共 11 个单元/集成测试文件、80 项测试全部通过。Playwright 2 个文件、10/10 通过。

浏览器测试在 127.0.0.1:3100 启动独立生产服务，使用临时 SQLite 数据库和本地模型 HTTP 替身，执行完成后清理测试数据库；禁用真实数据源凭证，不复用已运行的日常服务，不消耗真实模型额度。构建与浏览器服务在本环境需要沙箱外执行；沙箱内构建的 TypeScript 子进程错误和监听端口 EPERM 不能记作验证通过。

## 测试覆盖范围

- 四种论断分类（事实、观点、推测、传闻）及对应权重
- 同 URL 新版本 vs 内容哈希重复
- 重复导入幂等（不产生重复论断）
- 转载链折叠，不因数量增加权重
- 支持、冲突、否认、更正、替代、失效等结论状态转换
- 撤销证据后重算
- 截至某时视图排除未来证据
- 同公司不同事项不合并
- 逐字引用校验（伪造引用被拒绝）
- 模型返回非法分类、非法日期、非 JSON 时优雅降级
- 429 按 Retry-After 等待最多 3 次、5xx 退避、400/401/403 不重试
- 超时处理
- 种子数据结论历史匹配预期 8 个版本
- 同步模块：Provider 注册、同步代码去重、上游失败保留旧数据、pending 版本在名额内被分析、failed 版本不自动重试、文件锁与 busy 检测
- 扶摇行情嵌套结构、业务错误拒绝、新闻参数与字段映射
- iFinD 新闻多层 JSON 解包
- 单位口径隔离：不同单位/口径的论断分离存储，不产生误判冲突

## 未覆盖项（已知缺口）

- 无真实模型或数据源的自动化冒烟（人工验证已做，但无 API Key 不可重复）
- 无负载和压力测试
- 无自动化无障碍测试（WCAG 合规需辅助技术手工验证）

## 人工验证记录

1. 浏览器：导入 → 真实模型抽取（3 条论断）→ 候选按事项标识自动选中 → 关联 2 条 → 结论变化 → 撤销 → 回退
2. 结论历史：真实导入叠加种子数据后共 10 个版本
3. 事件列表：搜索、状态筛选、关注清单筛选均可用
4. 截至某时：历史结论排除未来证据
5. 数据源页：3 个真实来源（iFinD 公告、iFinD 新闻、扶摇新闻）+ 6 个构造来源
6. 健康检查：`GET /api/health` 返回 200、db ok
7. 当时的生产构建成功；当前构建结果以本页测试结果表为准

> 以上人工验证在开发过程中完成，最后一次代码变更后未全部重新验证。
> 早期真实 API 实测来自 macOS，详见 `docs/api-test-report-2026-10-25.md`。后续测试机部署和同步已完成；本轮 SSH 只读复核 service active、health 200、37 条真实资料分析完成且未归并，见 `docs/release-readiness.md`。本轮未部署修改、未重跑真实 API 调用。

## 真实 API 未覆盖场景

真实 API 验证仅覆盖 `300308.SZ` 一个标的，以下场景尚未自动化或复现：

- 多标的同步
- 分页与历史回填
- 限流（HTTP 429）
- 认证失败（HTTP 401/403）
- 长时间运行稳定性
- 使用真实上游响应的 UI 端到端：固定模型替身的完整链路已覆盖
- 本次新版本发布到测试机后的回归验证

## 本轮额外验证

- `npm run backup`：本机实际生成备份，SQLite `integrity_check` 为 ok；使用在线 backup API，包含 WAL 已提交内容。
- `bash -n deploy/setup.sh`、`git diff --check`：通过。
- 生产构建保留类型检查，没有 `ignoreBuildErrors`。
- Docker 镜像和新的 systemd/timer 模板未在目标环境执行，不能据静态检查声称部署验收完成。
- 用户决定演示版不增加模型额度控制；片段证据结论规则保持原样。新版本发布已获授权，但当前 SSH 认证失败，远端验收尚未执行，见 `docs/release-readiness.md`。
