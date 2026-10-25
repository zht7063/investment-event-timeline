# 数据源探测记录（2026-10-25）

探测脚本未入库；凭证从 `.env` 读取，不打印。以下请求与返回均已脱敏、截断。

| 来源 | 端点变量 | 认证 | 结果 |
| --- | --- | --- | --- |
| 扶摇 a-share MCP | `FUYAO_MCP_A_SHARE_URL` | 请求头 `X-api-key` | 可用。用 `Authorization: Bearer` 时返回业务码 2003 “Missing X-api-key” |
| 扶摇 news MCP | `FUYAO_MCP_NEWS_URL` | — | HTTP 405（nginx），不可用 |
| iFinD 资讯 MCP | `IFIND_MCP_URL` | 请求头 `Authorization: <token>` | 可用 |
| iFinD 股票 MCP | `IFIND_MCP_STOCK_URL` | 同上 | `initialize`/`tools/list` 成功，未调用数据工具 |
| 模型 | `AI_BASE_URL` + `AI_MODEL` | Bearer | 200，约 1.1 秒；先输出 `reasoning_content`，`max_tokens=20` 时 `content` 为空，需留足 token |
| 部署服务器 | `DEPLOY_SSH_TARGET` | SSH | `Permission denied (publickey,password)`，阻塞部署 |

协议：MCP Streamable HTTP，`initialize` → `notifications/initialized` → `tools/call`，响应为 SSE `data:` 行或 JSON。

## 接入决定

- 行情背景：扶摇 `get_a_share_prices_snapshot`，参数 `thscodes`（如 `300308.SZ`）。返回 `last_price`、`price_change_ratio_pct`、`turnover`、`timestamp`（毫秒）等。只作背景，不作证据。
- 同步资料：iFinD `search_notice`（公告片段）和 `search_news`（新闻片段），参数 `query`、`time_start`、`time_end`（YYYY-MM-DD）、`size`。`data` 字段是 JSON 字符串（news 外面再套一层 `data`），条目字段为中文键：
  - 公告：`公告标题`、`公告片段内容`、`日期`
  - 新闻：`资讯标题`、`资讯内容`、`日期`、`URL`
- 限制：只有片段没有全文；`日期` 只精确到日；公告没有 URL。规范键用 `ifind:notice:<标题>`，披露时间按日期精度存储。
