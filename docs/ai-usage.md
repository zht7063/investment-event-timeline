# AI 使用与验证记录

按时间追加，只记录实际发生的事。

## 工具

- Codex 桌面版（编码代理）：生成脚手架、领域规则、种子数据、测试，执行探测与命令。
- 产品内模型：`AI_MODEL` 指向的 OpenAI 兼容接口，仅用于论断抽取与归并候选理由（尚未接入代码）。

## 2026-10-25 第一小时

| 环节 | AI 做了什么 | 人工/验证 | 修正 |
| --- | --- | --- | --- |
| 依赖选型 | 查询 npm 当前版本并锁定 | `npm view` 输出 | AI 起初写了不存在的 `typescript@5.0.5` 作为最新版，查询 peer 依赖后改为 `5.9.3` |
| 数据探测 | 编写 MCP 探测脚本，调用扶摇/iFinD/模型 | 见 `docs/data-probe.md` | 扶摇首次用 Bearer 认证失败（业务码 2003），按错误信息改为 `X-api-key` 后成功 |
| 部署 | SSH 只读检查 | `Permission denied (publickey,password)` | 未解决，需用户提供密钥或密码 |
| schema | 生成 `schema.sql` | 种子集成测试 | 原唯一索引 `(event_id, claim_id)` 不允许同一论断对不同目标既反驳又支持（卖方 51% 说法既反驳 60%、又支持更正后的 51%），改为 `(event_id, claim_id, relation, target)` |
| 结论规则 | 生成 `computeConclusion` | 单元测试 + 种子历史逐条打印核对 | 编写种子数据时自查发现，第一版把“有效期已过”排在“已有证据支持”之后，导致意向协议到期后状态仍是“支持”；调整为到期且其后无新实质证据时判“已失效” |
| 测试预期 | 预写种子历史为 5 个版本 | 打印实际历史逐条核对 | 实际为 8 个版本，每次都对应有效证据变化（转述、补录研报等），确认规则正确，修改的是测试预期 |

## 2026-10-25 1:00–1:45（页面、AI 抽取、关联与撤销）

| 环节 | AI 做了什么 | 人工/验证 | 修正 |
| --- | --- | --- | --- |
| 重试策略 | 编写 `src/server/http.ts`（429 按 Retry-After 最多 3 次；5xx/超时 1s、2s 最多 2 次；400/401/403 不重试） | `tests/unit/http.test.ts` 用假 fetch 断言等待序列与尝试次数 | — |
| 抽取与引用校验 | 编写 `src/server/ai.ts`，Zod 校验 + 摘录逐字匹配 | 单元测试覆盖伪造引用、非法类别、非法日期、非 JSON | — |
| 真实模型冒烟 | 用构造的终止公告调用真实模型 | 浏览器导入页实测 | ① `.env` 中 `AI_MODEL` 值前有制表符，接口返回 400；改为读取时 trim。② 模型在正文未写代码时把 `event.subjectCode` 返回 null，导致整份输出被拒；改为允许 null，并在导入页增加“主体标的代码”提示字段作为回退 |
| 页面 | 列表、详情、导入三页及 API | 浏览器走通：导入 → 真实模型抽取 3 条论断 → 候选按事项标识自动选中 → 关联 2 条 → 结论 已失效→存在冲突 → 撤销 → 已有证据支持，历史共 10 版 | node:sqlite 行对象原型为 null，React 拒绝传给客户端组件，列表和导入页 500；在 repo 中转换为普通对象 |
| 展示 | 结论摘要模板 | 页面目检 | 已失效行显示了 UTC ISO 原始字符串，改为北京时间格式 |

## 2026-10-25 1:45-2:40（数据源、同步、部署）

| 环节 | AI 做了什么 | 人工/验证 | 修正 |
| --- | --- | --- | --- |
| 数据源连接器 | 编写 `fuyao.ts`（MCP a-share 行情快照、REST 新闻）和 `ifind.ts`（MCP 公告/新闻检索） | 类型检查通过，47 项测试全部通过 | 首版 fuyao.ts 的 map 回调参数类型不兼容 `unknown[]`，改为显式类型断言 |
| 同步模块 | 编写 `sync.ts`：Provider 注册表模式、文件锁、sync_runs 记录、自动分析（每轮最多 5 条） | 类型检查通过，`npm run build` 成功 | 第一版使用 `/tmp` 固定锁路径，重构为数据库路径旁的锁文件；Turbopack 警告动态文件系统访问，添加 turbopackIgnore 注释 |
| 数据源页面 | 编写 `sources/page.tsx` + `SourcesClient.tsx`：中文标签、过期横幅、待处理文档列表 | `npm run build` 17 路由全部注册 | 第一版使用英文标签和内联样式，重写为共享 `formatTime` 和 CSS 类 |
| 行情背景 | `MarketBackground.tsx` 在事件详情页展示关联标的行情 | 浏览器目检（构造数据标的不触发行情请求） | — |
| 部署 | systemd 单元文件、setup.sh、Dockerfile | 直接 `node next start` 验证：health check 200、events API 3 个事件、HTML 页面渲染正确 | `sudo systemctl` 在沙箱中不可用，改为直接 node 进程启动 |
| 同步脚本 | `scripts/sync.ts`、`npm run sync` | 类型检查通过 | — |
| valid_until 过期 | 确认已在读取路径中线上（`searchEvents` 对所有事件调用 `recompute`，`getEventDetail` 在实时视图也调用）| 种子数据的收购事件正确显示"已失效" | 无需额外修改，handoff 中标记的连线已在前一个 session 完成 |
