# Caddy 域名部署验收（2026-10-26）

入口：https://timeline.tianyubai.cn 。时间按新加坡时间记录。

## 配置与部署

- 测试服务器：185.115.207.143，项目目录 `/opt/evt-timeline`。
- Debian 11 使用 Caddy 官方 stable 软件源，安装 Caddy 2.11.7，systemd 开机启动。
- Cloudflare 已代理域名；宿主机 Caddy 转发至 `127.0.0.1:3000`。HTTP 自动跳转 HTTPS。
- Caddy 通过 HTTP-01 成功申请 Let's Encrypt 证书，源站证书通过正常 TLS 校验。
- `.env` 设置 `BIND_HOST=127.0.0.1`、`PORT=3000`，执行 `docker compose up -d --no-build` 重新创建三个服务，保留数据卷。
- 本次仅更新代理及部署文档，复用已发布应用镜像，无需重新构建或上传相同镜像。

## 验证

- Caddy 配置校验通过；web healthy，sync/research 运行。
- 公网域名及直接解析到源站的 HTTPS `/api/health` 均返回数据库健康。
- 源站 HTTP 返回 308，目标为 HTTPS；容器端口为 `127.0.0.1:3000`。
- 域名入口 Playwright 只读冒烟 7 项通过，包含事件详情、筛选、来源、导入入口和手机布局；未创建分析或删除研究。
- 部署前备份与部署后数据库均为：2 条研究、36 份资料、43 个自动事项、3 个人工事件。旧验收使用的 `002230.SZ` 在本次查询中为零，不将早期验收数量视为实时数据。

## 备份与回滚

- 数据库：`/app/data/backups/app-2026-10-25T19-03-47.877Z.db`（文件名为 UTC）。
- 应用镜像：`evt-timeline:before-caddy-20261026`。
- 环境配置：`/opt/evt-timeline/.env.before-caddy-20261026`。
- Caddy 原始配置：`/etc/caddy/Caddyfile.before-timeline`。

仅回滚代理时，恢复原 `.env` 并执行 `docker compose up -d --no-build`，恢复原 Caddyfile 后校验并 reload。数据库无需回滚，数据卷不得删除。

安装、DNS、Cloudflare 模式和复现命令见 [Docker 安装与更新](docker-install.md#绑定-timelinetianyubaicn-caddy-https)。
