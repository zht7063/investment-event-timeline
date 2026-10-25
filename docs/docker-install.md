# Docker 安装与更新

适用于单机演示部署，网页、定时同步和按需研究 worker 共享一个 SQLite 数据卷。

## 安装

服务器安装 Docker Engine 和 Compose v2。Ubuntu 24.04 可执行：

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
```

把项目放到服务器目录，进入该目录：

```bash
cp .local.env .env
chmod 600 .env
# 编辑 .env：填写 ADMIN_TOKEN、AI_* 及所需数据源凭证。
# 需要自动同步时填写 SYNC_CODES，例如 300308.SZ。
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

默认访问服务器的 3000 端口，云防火墙需允许访问。可在 `.env` 设置
`PORT=3000`、`BIND_HOST=0.0.0.0`、`SYNC_INTERVAL_MINUTES=30`。
管理口令用 `openssl rand -hex 24` 生成。不要把 SSH 密码放进部署用的 `.env`。

`web` 提供页面/API，`sync` 等待应用健康后同步，之后每隔指定分钟再次执行。
不要同时启动旧 cron/systemd 同步任务。未配置数据源时仍能浏览构造数据及人工导入。
首次数据库为空时自动加入构造演示数据。

## 日常命令

```bash
docker compose logs --tail=100 web sync research
docker compose restart
docker compose exec web npm run backup
mkdir -p backups
docker compose cp web:/app/data/backups/. ./backups/
```

数据保存在 `evt-timeline_app-data` 卷中，容器重启或重新构建不会删除它。
不要执行 `docker compose down -v`，该命令会删除数据卷。
演示重置接口也会清空真实导入的数据，不能用作更新步骤。

## 更新和回滚

```bash
docker compose exec web npm run backup
docker image tag evt-timeline:local evt-timeline:previous
# 更新项目源文件，保留 .env
docker compose build web
docker compose up -d --no-build
curl --fail http://127.0.0.1:3000/api/health
```

构建失败时旧容器继续运行。更新后有问题可恢复镜像：

```bash
docker image tag evt-timeline:previous evt-timeline:local
docker compose up -d --no-build --force-recreate
```

恢复数据库必须先停掉全部三个服务，避免研究 worker 继续写入。以 `backups/app-example.db` 为例：

```bash
docker compose stop web sync research
docker compose run --rm --no-deps -v "$PWD/backups:/restore:ro" web \
  sh -c 'rm -f /app/data/app.db-wal /app/data/app.db-shm && cp /restore/app-example.db /app/data/app.db'
docker compose up -d --no-build
```

恢复前应额外保留当前数据库备份，替换示例文件名为实际备份文件。

## 小内存服务器：先构建，再传输镜像

生产编译的内存需求高于日常运行。约 2 GB 内存的测试机推荐在资源充足、与服务器架构一致的机器构建，再加载到服务器；不要在服务失去响应时重复启动构建。

构建机执行（`.dockerignore` 已排除运行凭证和数据库）：

```bash
docker build -t evt-timeline:release .
docker save evt-timeline:release | gzip -1 > /tmp/evt-timeline-image.tar.gz
scp /tmp/evt-timeline-image.tar.gz 用户@服务器:/tmp/
```

服务器先按上文备份现有数据库及镜像，再执行：

```bash
docker load -i /tmp/evt-timeline-image.tar.gz
docker tag evt-timeline:release evt-timeline:local
cd /opt/evt-timeline
docker compose up -d --no-build
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

源码、Compose 配置与镜像版本应保持一致；运行凭证仅保存在服务器 `.env`，不得打入镜像。首次安装没有旧数据库或旧镜像时无需做旧版本备份，启动并验收后应验证一次在线备份。

## 后续绑定域名

旧演示部署使用宿主机 Caddy 接收 80 端口请求，容器仅监听
`127.0.0.1:3000`；新测试服务器当前直接提供 3000 端口，见 [部署记录](research-deployment-2026-10-26.md)。如果服务器已有透明代理，采用 Caddy 方式可避免 Docker
直接公开端口与代理路由冲突。无域名时可先安装 HTTP 入口：

```bash
sudo apt-get install -y caddy
# 在 .env 设置 PORT=3000、BIND_HOST=127.0.0.1
docker compose up -d
sudo cp deploy/Caddyfile.http /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable caddy
sudo systemctl restart caddy
```

如果机器已有 Caddy 站点，先备份并合并配置，避免覆盖其他站点。

1. 将域名的 A 记录指向服务器；若配置 AAAA，确保 IPv6 也能访问。
2. 放行 80、443 端口，在服务器安装 Caddy。
3. 将 `deploy/Caddyfile` 中 `events.example.com` 改为实际域名，安装到 Caddy 配置目录并重新加载。
4. Caddy 在宿主机运行时，将 `.env` 设为 `PORT=3000`、`BIND_HOST=127.0.0.1`，执行 `docker compose up -d`，只通过代理公开访问。
5. 检查 HTTPS 首页、导入页、来源页及健康接口。域名未确定前可先用 IP 演示。

项目中的 Caddyfile 为后续接入模板，复制文件本身不会自动绑定域名。

## 发布后浏览器验收

在已安装开发依赖和 Playwright Chromium 的本机执行只读冒烟测试：

```bash
E2E_BASE_URL=http://服务器IP:3000 npm run test:e2e -- tests/e2e/smoke.test.ts --workers=1
```

完整导入/归并回归使用默认本地临时数据库：`npm run build && npm run test:e2e -- --workers=1`。

## 股票区间研究 worker

新版 Compose 新增 `research` 服务，与网页共用 `app-data` 卷；`sync` 是旧版预设标的同步，两者用途不同。更新镜像后执行 `docker compose up -d --build` 会创建研究 worker。访问 `/research` 查询任意有效 A 股代码，不需要修改 `SYNC_CODES`。

```bash
docker compose ps
docker compose logs --tail=100 research
```

必须配置 `FUYAO_API_KEY`、`FUYAO_MCP_META_URL` 用于名称核验，资讯及模型凭证沿用 `.local.env`。新增研究表由应用启动时增量创建，不删除原有数据；更新前仍应做在线备份。

直跑或 systemd 部署需额外守护 `npm run research:worker`（工作目录同应用、Node 24+、相同 `.env` 和数据库）。只运行 `npm start` 时任务会留在队列，不会自动抓取。旧 `deploy/setup.sh` 尚只安装网页与预设同步，本轮推荐使用 Compose。

默认每来源扶摇100页、iFinD64个日窗口。达到上限显示“覆盖受限”；“重试未完成部分”只处理失败任务，“继续检索更多资料”为仍有断点的来源增加100次检索额度。参数见 `RESEARCH_MAX_NEWS_PAGES`、`RESEARCH_MAX_SEARCH_WINDOWS`。

本轮没有启用生产访问控制、自动订阅或报告历史比较；这些属于方案 D/E 阶段。研究资料独立于演示数据，演示重置不会删除研究资料。
