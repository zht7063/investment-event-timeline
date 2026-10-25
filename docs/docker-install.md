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
touch .env
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

## 绑定 timeline.tianyubai.cn（Caddy HTTPS）

访问路径：浏览器 → Cloudflare（当前已开启代理）→ 宿主机 Caddy 的 443 端口 → `127.0.0.1:3000` → web 容器。应用镜像无需修改。

Cloudflare 开启代理时，公网 DNS 返回 Cloudflare 地址属正常现象；DNS 控制台的源站仍应填写 `185.115.207.143`。SSL/TLS 使用 Full (strict)，避免 Flexible 与源站 HTTPS 重定向形成循环。保留 HTTP ACME 验证路径可达，当前源站已通过 HTTP-01 获取公开可信证书。

1. 在 DNS 控制台添加 A 记录：`timeline` → `185.115.207.143`。不要配置不可用的 AAAA 记录。
2. 云防火墙及宿主机放行 TCP 80、443；UDP 443 可选，用于 HTTP/3。保留现有 SSH 端口。
3. 安装 Caddy，备份数据库、`.env` 与现有 Caddy 配置；已有其他站点时合并本站配置，不覆盖它们。

```bash
# Debian 11 默认源可能没有 Caddy，使用官方 stable 软件源
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg curl
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o /tmp/caddy.gpg
sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg /tmp/caddy.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /tmp/caddy-stable.list
sudo install -m 644 /tmp/caddy-stable.list /etc/apt/sources.list.d/caddy-stable.list
sudo chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo apt-get update
sudo apt-get install -y caddy
cd /opt/evt-timeline
docker compose exec -T web npm run backup
cp -p .env .env.before-caddy
# 编辑 .env，设置 PORT=3000、BIND_HOST=127.0.0.1
# 以下复制适用于没有其他站点的新 Caddy 安装
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
docker compose up -d --no-build
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

`deploy/Caddyfile` 内容：

```caddyfile
timeline.tianyubai.cn {
    reverse_proxy 127.0.0.1:3000
}
```

DNS 生效且 80/443 可从公网访问后，Caddy 自动申请、续期证书，并将 HTTP 重定向到 HTTPS，详见 [Caddy 自动 HTTPS 文档](https://caddyserver.com/docs/automatic-https)。证书存储由宿主机 Caddy 服务持久化，不随应用容器重建删除。

```bash
getent ahostsv4 timeline.tianyubai.cn
curl --fail http://127.0.0.1:3000/api/health
curl -I http://timeline.tianyubai.cn
curl --fail https://timeline.tianyubai.cn/api/health
sudo journalctl -u caddy --since '10 minutes ago' --no-pager
docker compose ps
```

健康接口成功后检查首页、事件页、资料页和研究详情；只读验收，不创建真实分析任务。启用回环绑定后，公网 `IP:3000` 不再是访问入口。若域名尚未解析，可先安装配置并保留原 `BIND_HOST=0.0.0.0`，待 HTTPS 验证成功后再切换为回环绑定，避免切断现有入口。

回滚：恢复备份的 `.env` 后执行 `docker compose up -d --no-build`；恢复原 Caddy 配置并验证、reload。不要删除数据卷，也不需要恢复数据库来回滚代理配置。

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

## 研究资料与统一事件库回填

新版在成功分析的同一事务中更新自动事项索引。既有研究用以下命令回填；不重新抓取、不调用模型、不修改原区间报告或人工证据。已取消、失败和未完成研究同样保留。

```bash
# 先在数据库备份副本演练；DATABASE_PATH 指向副本，绝不能替换在线库。
DATABASE_PATH=/tmp/rehearsal.db npm run library:backfill -- --dry-run
DATABASE_PATH=/tmp/rehearsal.db npm run library:backfill
# 再执行一次应得到相同数量；失败项输出 jobId，退出码非零。
DATABASE_PATH=/tmp/rehearsal.db npm run library:backfill
```

实际升级先备份数据库、镜像及源文件，在新镜像就绪后暂停 web/sync/research，保留共享数据卷，执行：

```bash
docker compose stop web sync research
docker compose run --rm --no-deps web npm run library:backfill -- --dry-run
docker compose run --rm --no-deps web npm run library:backfill
docker compose up -d --no-build
```

Compose 的 sync/research 没有健康检查，不使用全服务 `--wait` 作为成功判断；检查 web healthy、worker 日志与容器运行状态，再验收 `/api/health`、`/events?q=002230.SZ` 和 `/events?tab=materials&q=002230.SZ`。

新接口 `/api/library/events` 与 `/api/library/materials` 支持 `q`、`origin=all|automatic|manual`、`codes`、`watched=1`、`limit`、`offset`；事件支持原结论 `status` 筛选。分页前过滤，超出范围的页码回到末页。`/api/library/events/{id}?job={研究ID}` 查询自动事项在指定研究中的证据；省略 job 默认最近更新记录。原 `/api/events` 仍供旧人工事件流程使用。

## Docker Hub 镜像

仓库：`zht7063/investment-event-timeline`。`latest` 指向最近发布版本，`git-<短提交号>` 用于固定部署版本。当前发布平台为 Linux amd64。

现有 Compose 部署可拉取镜像后映射到本地运行标签，无需在测试机编译：

```bash
cd /opt/evt-timeline
docker compose exec -T web npm run backup
docker pull zht7063/investment-event-timeline:latest
docker image tag evt-timeline:local evt-timeline:previous
docker image tag zht7063/investment-event-timeline:latest evt-timeline:local
docker compose up -d --no-build
curl --fail http://127.0.0.1:3000/api/health
```

首次从旧版升级到统一事件库时，仍需按上文暂停服务执行一次历史回填。运行凭证由服务器 `.env` 提供，数据库保存在现有数据卷；镜像不包含运行凭证或真实研究数据库。
