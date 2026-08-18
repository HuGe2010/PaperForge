# 接口约定（P1）

所有接口前缀 `/api`。除登录/刷新/健康检查外，均需 `Authorization: Bearer <accessToken>`。

## 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录，返回 `{ accessToken, refreshToken, user }` |
| POST | `/api/auth/refresh` | 用 refreshToken 换取新的令牌对（旧 refresh 令牌被吊销） |
| POST | `/api/auth/logout` | 吊销指定 refreshToken |
| POST | `/api/auth/logout-all` | 吊销当前用户全部 refreshToken（踢人） |
| GET  | `/api/auth/me` | 返回当前用户（含 roles / permissions） |

### 令牌

- **Access Token**（默认 30 分钟）：放在请求头 `Authorization: Bearer <token>`。
- **Refresh Token**（默认 7 天）：存储于 `refresh_tokens` 表，可吊销；过期或吊销后需重新登录。
- 权限信息（permissions）嵌入 Access Token 载荷，请求时由 `PermissionsGuard` + `@RequirePermissions()` 校验。

## 用户 / 角色 / 权限

| 方法 | 路径 | 权限 |
|---|---|---|
| GET  | `/api/users?page=&pageSize=&keyword=&role=` | `user:read` |
| GET  | `/api/users/:id` | `user:read` |
| POST | `/api/users` | `user:create` |
| PATCH| `/api/users/:id` | `user:update` |
| DELETE | `/api/users/:id` | `user:delete` |
| GET  | `/api/roles` | `role:read` |
| POST | `/api/roles` | `role:create` |
| PATCH| `/api/roles/:id` | `role:update` |
| PUT  | `/api/roles/:id/permissions` | `role:update` |
| DELETE | `/api/roles/:id` | `role:delete`（系统内置角色不可删） |
| GET  | `/api/permissions` | `role:read` |
| GET  | `/api/permissions/groups` | `role:read` |

## 系统设置（AI Key 等）

| 方法 | 路径 | 权限 |
|---|---|---|
| GET  | `/api/settings` | `setting:read` |
| GET  | `/api/settings/:group` | `setting:read` |
| PUT  | `/api/settings/:group` | `setting:update` |

`group` 约定：`llm`（文本模型 / 解题 / 评分）、`vlm`（视觉模型 / 识题）、`system`。
密钥类配置 `isSecret=true`，读取时加密存储、列表接口不返回明文。

## 健康检查

| 方法 | 路径 | 说明 |
|---|---|---|
| GET  | `/api/health` | 返回 database / redis 状态（无需认证） |

## 统一错误格式

```json
{ "code": 401, "message": "用户名或密码错误", "path": "/api/auth/login", "timestamp": "..." }
```

- 权限不足返回 `403`；未登录返回 `401`；参数错误返回 `400`（含字段级中文提示）。
