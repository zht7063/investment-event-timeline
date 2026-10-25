import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "evt-e2e-"));
const model = createServer(async (req, res) => {
  const send = (payload) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  if (req.url.startsWith("/api/news/stock/timeline-list")) {
    const url = new URL(req.url, "http://fixture");
    const second = url.searchParams.get("offset") !== "first";
    send({
      code: 0,
      data: {
        items: [
          {
            id: second ? "research-b" : "research-a",
            title: "构造验收资料：贵州茅台甲方项目",
            source: "构造测试来源",
            summary: second
              ? "贵州茅台公告：2026年9月甲方项目未获批准，否认已获批准的报道。"
              : "贵州茅台公告：2026年9月甲方项目已获批准。",
            publish_time_ms: Date.parse(
              second ? "2026-09-03T01:00:00Z" : "2026-09-02T01:00:00Z",
            ),
            jump_url: "https://example.com/research/" + (second ? "b" : "a"),
          },
        ],
        has_more: !second,
        offset: second ? "end" : "second",
      },
    });
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body);
  if (req.url === "/mcp") {
    if (input.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }
    if (input.method === "initialize") {
      send({
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: { name: "fixture", version: "1" },
        },
      });
      return;
    }
    const payload =
      input.params.name === "get_meta_tickers_search"
        ? {
            code: 0,
            data: {
              item: [
                { thscode: "600519.SH", ticker: "600519", name: "贵州茅台" },
              ],
            },
          }
        : { code: 1, data: [] };
    send({
      result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
    });
    return;
  }
  const user = input.messages.at(-1).content;
  if (input.messages[0].content.includes("你是证据研究抽取器")) {
    const material = JSON.parse(user);
    await new Promise((resolve) => setTimeout(resolve, 250));
    send({
      choices: [
        {
          message: {
            content: JSON.stringify({
              relevance: "direct",
              relevanceQuote: material.body,
              reason: "正文明确提及目标公司",
              events: [
                {
                  title: "甲方项目审批（构造验收）",
                  type: "investment",
                  objectAnchor: "甲方项目",
                  periodAnchor: "2026年9月",
                  claims: [{ quote: material.body, category: "fact" }],
                },
              ],
            }),
          },
        },
      ],
    });
    return;
  }
  if (input.messages[0].content.includes("你是证据关系核验器")) {
    const { evidence } = JSON.parse(user),
      from = evidence.find((e) => e.quote.includes("否认")),
      to = evidence.find((e) => !e.quote.includes("否认"));
    send({
      choices: [
        {
          message: {
            content: JSON.stringify({
              links:
                from && to
                  ? [
                      {
                        from: from.id,
                        to: to.id,
                        relation: "refutes",
                        reason: "后续公告明确否认获批报道",
                        fromQuote: from.quote,
                        toQuote: to.quote,
                      },
                    ]
                  : [],
            }),
          },
        },
      ],
    });
    return;
  }
  const quote = user.split("<document>\n")[1].split("\n</document>")[0];
  const title = user.match(/标题：([^\n]+)/)[1];
  const result = {
    event: {
      title,
      subjectCode: "DEMO-E2E",
      eventType: "investment",
      matterKey: `e2e:${title}`,
    },
    claims: [{ quote, category: "fact", content: quote }],
  };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(result) } }],
    }),
  );
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));

const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_PATH: join(directory, "app.db"),
      ADMIN_TOKEN: "e2e-admin",
      AI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
      AI_MODEL: "e2e-fixture",
      AI_API_KEY: "e2e-only",
      FUYAO_API_KEY: "",
      IFIND_TOKEN: "",
      SYNC_CODES: "",
    },
  },
);
const worker = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/research-worker.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_PATH: join(directory, "app.db"),
      AI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
      AI_MODEL: "fixture",
      AI_API_KEY: "fixture",
      FUYAO_API_KEY: "fixture",
      FUYAO_BASE_URL: `http://127.0.0.1:${model.address().port}`,
      FUYAO_MCP_META_URL: `http://127.0.0.1:${model.address().port}/mcp`,
      IFIND_TOKEN: "fixture",
      IFIND_MCP_URL: `http://127.0.0.1:${model.address().port}/mcp`,
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    child.kill(signal);
    worker.kill(signal);
  });
child.on("exit", (code) => {
  worker.kill("SIGTERM");
  model.close();
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = code ?? 0;
});
