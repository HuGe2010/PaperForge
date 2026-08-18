# 部署文档

## 一、环境要求

- Docker ≥ 24 与 Docker Compose ≥ v2
- 建议内存 ≥ 2.3 GB（全栈：PG 640M + Redis 320M + backend 1200M + frontend 128M）
- 对外仅需放通 **9280** 端口（前端），后端 / 数据库 / Redis 均在内网

## 二、快速部署

```bash
cd <项目根>
cp .env.example .env
# 编辑 .env：修改 POSTGRES_PASSWORD、JWT_SECRET、JWT_REFRESH_SECRET 为强随机值
docker compose build
docker compose up -d
```

启动后访问 `http://<服务器IP>:9280`。

### 初始化数据库与种子

首次启动后，在 backend 容器内执行迁移与种子（compose 已配置 `migrate deploy` 在启动命令中，首次会自动建表）：

```bash
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run seed
```

种子会创建：
- 管理员账号 `admin` / 密码 `Exam@2024!`（请立即登录修改）
- 三角色 `ADMIN` / `TEACHER` / `STUDENT` 及完整权限码

## 三、环境变量

见 `.env.example`。注意：

- **AI 的 API Key 不要写进 `.env` / compose**。登录后在「系统设置 → AI 配置」页由管理员填写，加密存库，运行时读取。
- `WEB_PORT` 可改前端暴露端口（默认 9280）。
- `LLM_*` / `VLM_*` 在 `.env` 仅提供非密钥默认值（provider / baseURL / model），Key 走设置页。

## 四、数据备份

数据全部落在 `./data/`：

- `data/postgres`：PostgreSQL 数据目录
- `data/redis`：Redis 持久化
- `data/uploads`：OCR 原图 / 裁题图
- `data/exports`：导出的试卷 PDF / Word

备份建议（停机或快照）：直接打包 `./data/`；数据库也可用 `pg_dump`：

```bash
docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql
```

## 五、NAS（飞牛 fnOS）注意

- 将项目放到 NAS 共享目录（如 `/vol1/1000/docker/exam/`）便于快照。
- 若 NAS 内存紧张：调低 `docker-compose.yml` 中 `deploy.resources.limits`，并把后续 OCR 队列并发降到 1。
- Redis 必须使用 `noeviction`，否则 BullMQ 任务可能被 LRU 淘汰。

## 六、健康检查

- 后端：`GET /api/health` 返回 `database` 与 `redis` 状态（供容器健康检查使用）。
- 前端：容器返回 `200` 即视为健康。
