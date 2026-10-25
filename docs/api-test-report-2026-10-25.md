# 数据源连接器真实 API 测试报告（2026-10-25）

## 测试环境与范围

- 执行位置：本地 `/Users/iris/Documents/projects/investment-event-timeline`，没有在远端 `/home/zht/projects/investment-event-timeline` 执行。
- 测试时间：2026-10-25，Asia/Singapore（UTC+8）。
- Node.js：v26.8.2；Next.js：16.4.3。
- `.env` 中五个前提变量均已配置；新增 `SYNC_CODES=300308.SZ`。实际数据库为 `./data/app.db`。
- 使用真实配置调用 iFinD 公告/新闻 MCP、扶摇 A 股行情 MCP、扶摇新闻 REST；未使用 mock 代替真实 API 验证。另用脱敏响应结构编写了离线回归测试。
- 初次沙箱执行同步得到 `UPSTREAM_UNAVAILABLE (network)`，启动服务得到 `listen EPERM`。在获准的联网环境重跑后 MCP 初始化均 HTTP 200；首轮失败不能据此归因于凭证或上游服务。沙箱失败记录保留在数据库中。
- 本文不包含密钥、Token、完整服务地址或认证请求头值。测试完成后已停止本次启动的本地服务，并恢复 Next.js 自动修改的 `next-env.d.ts`。

## 发现与修复

| 项目 | 现场现象与原因 | 修复 |
| --- | --- | --- |
| 扶摇行情 | HTTP 200，但 `/api/prices` 返回 `prices: []`。真实行位于 `data.item`，时间戳位于 `data.timestamp`，旧代码把外层对象当作行情行，随后因代码为空被路由过滤 | 读取 `data.item`，回退使用外层毫秒时间戳 |
| iFinD 新闻 | 同步显示 `ok / 0 new`，实际工具返回了新闻。响应文本为 `{code:1, data:{data:"[中文键条目]"}}`，旧代码只解开一层 | 递归解开 JSON 字符串及 `data` 包装；中文标题、片段、日期和 URL 字段名实测正确 |
| 扶摇新闻参数 | 旧请求缺少 `offset`，HTTP 200 但业务码 `1001`，提示 `Missing required parameter: offset`；加入 `offset=0` 或同时保留 `limit` 时，得到业务码 `1002 / Invalid parameter format` | 按 `.env` 已有注释使用 `offset=first`，不向上游传 `limit`，在本地截取请求数量 |
| 扶摇新闻字段 | 可用请求响应为 `data.items`，正文是摘要 `summary`，时间是 `publish_time_ms`，链接是 `jump_url`，旧字段映射无法导入 | 映射上述字段，并将毫秒时间转为 ISO 时间 |
| 扶摇业务错误 | 非零业务码原先被当作空数组成功，掩盖接口参数错误 | 非零业务码抛错，交由已有同步错误处理记录失败 |
| 同步回归测试排序 | 两次运行可能具有相同毫秒时间戳，只按 `started_at` 排序会取错记录，造成偶发失败 | 测试查询增加 `rowid desc` 作为次级排序；未修改生产同步逻辑 |

调用范围核对：`getNewsTimeline`、`searchNotice`、`searchNews` 由 `src/server/sources/sync.ts` 使用；`getPriceSnapshot` 由 `src/app/api/prices/route.ts` 使用。没有新增依赖、修改数据库结构或重置数据库。

## 真实同步结果

首次可联网的修复前运行（开始于 16:06:46）：

```text
[sync] ifind-notice ok: +7 new, 0 duplicate, 4 analyzed
[sync] ifind-news ok: +0 new, 0 duplicate, 0 analyzed
[sync] fuyao-news ok: +0 new, 0 duplicate, 0 analyzed
```

新闻两个来源的 `ok / 0` 是上述解析或业务码处理错误造成的假成功，不能作为连接器验收结果。公告实际创建 7 个版本，前 5 个尝试分析，其中 4 个成功、1 个失败，另外 2 个因每来源每轮最多分析 5 个的预算保持 pending。

修复后再次运行 `npm run sync`（开始于 16:11:08，本轮退出码 0）：

| source | status | new | duplicate | analyzed |
| --- | --- | ---: | ---: | ---: |
| ifind-notice | ok | 0 | 7 | 0 |
| ifind-news | ok | 10 | 0 | 5 |
| fuyao-news | ok | 20 | 0 | 5 |

三个来源均完成真实 API 调用及落库，公告重复导入未创建重复版本。本轮新增 30 条资料版本、成功分析 10 条；前次公告的分析失败未被重复同步重试。

没有出现“凭证未配置”或“没有可同步的真实标的”。已完成的联网请求未观察到 HTTP 401、403、429 或 5xx；这不证明限流和故障永远不会发生。

## 行情 HTTP 测试

本地运行 `npm run dev -- --hostname 127.0.0.1`，并通过 HTTP 请求真实服务。除人工查看响应外，额外用 Node `assert` 检查有效代码对应单条非空行情、正数价格、有限数值涨跌幅和成交额、可解析时间戳，以及无效代码 HTTP 400。

```sh
curl 'http://127.0.0.1:3000/api/prices?codes=300308.SZ'
curl 'http://127.0.0.1:3000/api/prices?codes=DEMO-A'
```

修复后响应样例（HTTP 200，断言通过）：

```json
{"prices":[{"code":"300308.SZ","name":"","lastPrice":612.63,"changeRatioPct":3.816238,"turnover":27918480000,"timestamp":"2026-10-25T08:12:25.000Z"}],"unavailable":false}
```

无效代码响应（HTTP 400，断言通过）：

```json
{"error":{"code":"VALIDATION_FAILED","message":"no valid ticker codes (expected format: 300308.SZ)"}}
```

上游实测行情行不包含公司名称，因此 `name` 为空字符串，没有人为补填；行情时间戳为上游返回值，不据此断言交易时间或实时行情的新鲜度。

## 数据库核对

通过 Node 内置 `node:sqlite` 只读执行下列 SQL，与需求中的 sqlite3 查询等价。`sync_runs` 没有 analyzed 列，分析成功数以 CLI 输出和 `document_versions.analysis_status` 为准；`added` 在这里包含新导入的版本，不能直接当作新增文档数。

```sql
select id, source_id, status, added, error
from sync_runs order by started_at desc limit 5;

select id, title, source_id
from documents order by rowid desc limit 10;
```

最近 5 次同步（UTC 时间）：

```json
[
  {
    "id": "d35c90be-e5c3-47e3-ac77-680548468cc8",
    "source_id": "fuyao-news",
    "started_at": "2026-10-25T08:12:08.663Z",
    "finished_at": "2026-10-25T08:13:07.762Z",
    "status": "ok",
    "added": 20,
    "duplicates": 0,
    "error": null
  },
  {
    "id": "4464ea53-e5f5-4e09-8a39-3bc3b68b03b3",
    "source_id": "ifind-news",
    "started_at": "2026-10-25T08:11:08.834Z",
    "finished_at": "2026-10-25T08:12:08.662Z",
    "status": "ok",
    "added": 10,
    "duplicates": 0,
    "error": null
  },
  {
    "id": "6f5897eb-f632-4cf2-8e26-8513b34ffe03",
    "source_id": "ifind-notice",
    "started_at": "2026-10-25T08:11:08.052Z",
    "finished_at": "2026-10-25T08:11:08.832Z",
    "status": "ok",
    "added": 0,
    "duplicates": 7,
    "error": null
  },
  {
    "id": "f7f3d63c-fe1c-4150-b97d-a1db66803321",
    "source_id": "fuyao-news",
    "started_at": "2026-10-25T08:08:19.819Z",
    "finished_at": "2026-10-25T08:08:20.264Z",
    "status": "ok",
    "added": 0,
    "duplicates": 0,
    "error": null
  },
  {
    "id": "9520ed44-c869-4026-80ac-93cdb90f22c3",
    "source_id": "ifind-news",
    "started_at": "2026-10-25T08:08:18.939Z",
    "finished_at": "2026-10-25T08:08:19.817Z",
    "status": "ok",
    "added": 0,
    "duplicates": 0,
    "error": null
  }
]
```

最近 10 条文档：

```json
[
  {
    "id": "9026c26f-feea-42e0-a10a-bdc2a1f595f1",
    "title": "中际旭创成交额超250亿元",
    "source_id": "fuyao-news"
  },
  {
    "id": "c9eedfb2-6980-408f-a18b-18b04f5a686e",
    "title": "中际旭创：产能利用率充足 客户订单需求强劲",
    "source_id": "fuyao-news"
  },
  {
    "id": "d1c1c962-9aef-412e-b7da-ca3533c93c14",
    "title": "光通信企业集体发声 股价直线拉升翻红",
    "source_id": "fuyao-news"
  },
  {
    "id": "eed5f9f8-2423-4b42-8b46-a046a3c1c46a",
    "title": "6G AI-RAN产品发布叠加光通信订单饱满，AI算力与高速互连进入实质落地阶段",
    "source_id": "fuyao-news"
  },
  {
    "id": "9d1d33d6-074c-40cb-8fd5-30e56995f62a",
    "title": "10月23日创业板成交额前十大个股，中际旭创居首",
    "source_id": "fuyao-news"
  },
  {
    "id": "dc62a5f1-d01e-4f36-9ce4-978e5b341d8f",
    "title": "大逆转！利好来了，全线翻红",
    "source_id": "fuyao-news"
  },
  {
    "id": "77609f53-af3f-4caa-b3e2-12460554fcb4",
    "title": "5天3次“20cm”涨停！A股反弹日，这些个股，爆发！",
    "source_id": "fuyao-news"
  },
  {
    "id": "7965b59f-13b0-4c59-8528-768607abe0c6",
    "title": "中际旭创(10月23日)出现4笔大宗交易",
    "source_id": "fuyao-news"
  },
  {
    "id": "36121320-f75b-464e-956e-6cb7a1aae96e",
    "title": "上午大跌下午拉涨！“易中天”股价翻飞，还能相信“光”吗？",
    "source_id": "fuyao-news"
  },
  {
    "id": "a10b230c-17aa-4e4d-a9c2-7b8003b06389",
    "title": "中际旭创：上半年归母净利136.51亿元 同比增长241.70%， 拟变更回购股份用途为注销",
    "source_id": "fuyao-news"
  }
]
```

真实来源累计版本分析状态（两轮联网运行合计，非单轮 new 数）：

```json
[
  {
    "source_id": "fuyao-news",
    "analysis_status": "done",
    "versions": 5
  },
  {
    "source_id": "fuyao-news",
    "analysis_status": "pending",
    "versions": 15
  },
  {
    "source_id": "ifind-news",
    "analysis_status": "done",
    "versions": 5
  },
  {
    "source_id": "ifind-news",
    "analysis_status": "pending",
    "versions": 5
  },
  {
    "source_id": "ifind-notice",
    "analysis_status": "done",
    "versions": 4
  },
  {
    "source_id": "ifind-notice",
    "analysis_status": "failed",
    "versions": 1
  },
  {
    "source_id": "ifind-notice",
    "analysis_status": "pending",
    "versions": 2
  }
]
```

分析失败记录：

```json
[
  {
    "source_id": "ifind-notice",
    "title": "中际旭创：关于公司近期生产经营情况的公告",
    "analysis_error": "AI_UPSTREAM：模型调用失败"
  }
]
```

失败公告已保留，可通过现有分析接口重试；本次没有额外触发重试。

## 回归验证

- `npm test`：9 个测试文件、66 项测试全部通过。
- `npm run typecheck`：通过。
- `git diff --check`：通过。
- 新增 `tests/unit/connectors.test.ts` 四项回归：真实行情嵌套结构及共享时间戳、iFinD 新闻多层 JSON、扶摇 HTTP 200 业务错误、扶摇首屏参数与字段映射。均先在修复前观察失败，再修复并通过。

## 限制与后续风险

- 本次只验证 `300308.SZ`，未覆盖其他市场、多代码、分页历史回填、长时间稳定性、限流压力或真实认证失败场景。
- 扶摇新闻只取首屏最多 20 条，来源仅给出摘要；iFinD 仅给片段及日精度时间。接口通畅不代表资料完整，也不代表所有返回内容都与投资事项强相关。
- 同步会实际写入本地数据库并触发已配置模型调用。模型分析结果与数据源连接成功分开判断；`sync status=ok` 不保证每个版本分析成功。
- 未运行 UI 端到端测试或生产构建，也未部署。
