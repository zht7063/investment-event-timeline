import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "evt-e2e-"));
const model = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body);
  const user = input.messages.at(-1).content;
  const quote = user.split("<document>\n")[1].split("\n</document>")[0];
  const title = user.match(/标题：([^\n]+)/)[1];
  const result = {
    event: { title, subjectCode: "DEMO-E2E", eventType: "investment", matterKey: `e2e:${title}` },
    claims: [{ quote, category: "fact", content: quote }],
  };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3100"], {
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
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  model.close();
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = code ?? 0;
});
