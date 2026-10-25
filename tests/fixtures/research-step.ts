import { openDb } from "../../src/server/db";
import { workOnce } from "../../src/server/research/worker";
const db = openDb(process.argv[2]);
await workOnce(db, {
  resolve: async () => ({ code: "600519.SH", name: "构造测试公司" }),
  configured: () => true,
  fetch: async () => ({
    items: [],
    rawCount: 0,
    invalid: 0,
    exhausted: true,
    next: null,
  }),
});
db.close();
