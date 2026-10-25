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
| Build | `npm run build` | 17 路由注册、0 错误 | Pass |
| Typecheck | `npm run typecheck` | 0 错误 | Pass |
| Playwright | tests/e2e/smoke.test.ts | health、首页、事件详情、数据源、导入、状态筛选 | Pass (6/6) |

共 9 个测试文件、70 项测试全部通过。Playwright 6/6 通过。

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

- Playwright 冒烟（6 用例）仅检查页面能否打开和导航，不含导入→关联→撤销的完整浏览器链路；状态筛选用例通过 URL 参数直接跳转，未覆盖表单按钮点击（冷启动渲染超时）
- 无真实模型或数据源的自动化冒烟（人工验证已做，但无 API Key 不可重复）
- `/api/prices` 端点无自动化测试
- 无负载和压力测试
- 无自动化无障碍测试（WCAG 合规需辅助技术手工验证）

## 人工验证记录

1. 浏览器：导入 → 真实模型抽取（3 条论断）→ 候选按事项标识自动选中 → 关联 2 条 → 结论变化 → 撤销 → 回退
2. 结论历史：真实导入叠加种子数据后共 10 个版本
3. 事件列表：搜索、状态筛选、关注清单筛选均可用
4. 截至某时：历史结论排除未来证据
5. 数据源页：3 个真实来源（iFinD 公告、iFinD 新闻、扶摇新闻）+ 6 个构造来源
6. 健康检查：`GET /api/health` 返回 200、db ok
7. 生产构建：17 路由、0 错误

> 以上人工验证在开发过程中完成，最后一次代码变更后未全部重新验证。
> 真实 API 同步仅在用户本机（macOS）对 `300308.SZ` 执行过，本服务器未复现。详见 `docs/api-test-report-2026-10-25.md`。

## 真实 API 未覆盖场景

真实 API 验证仅覆盖 `300308.SZ` 一个标的，以下场景尚未自动化或复现：

- 多标的同步
- 分页与历史回填
- 限流（HTTP 429）
- 认证失败（HTTP 401/403）
- 长时间运行稳定性
- UI 端到端（导入→关联→撤销完整链路）
- 生产构建部署后的回归验证
