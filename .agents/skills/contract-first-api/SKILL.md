---
name: contract-first-api
description: >-
  Use when adding or changing shared API requests, responses, or cross-layer data contracts
  in SthStart, or implementing service routes that consume them. Align contracts, service
  validation, and frontend API clients without moving private implementation types into contracts.
---

# SthStart 契约驱动 API 开发

## 边界与实现顺序

- 先查 `packages/contracts/src/` 的现有契约。新增或改变跨端请求、响应时，先调整 TypeBox Schema 与 `Static` 类型，再实现服务端和前端调用；在 `packages/contracts/src/index.ts` 导出新增模块。
- 服务内部模型、UI 状态和私有辅助类型可以留在所属模块。只修复既有接口的实现、不改变对外字段时，不必修改契约。
- 检查已有调用方、返回包装和错误形状；新增字段考虑旧数据，局部更新区分字段缺失与显式清空，不顺带重构无关接口。

## 服务端与前端接入

- 在 `apps/service/src/` 对应业务模块接入共享契约，沿用该模块的路由注册、鉴权和运行时校验方式。TypeScript 类型不等于请求校验，不能依靠类型断言接受任意输入。
- 使用 Fastify response schema 时，核对完整返回结构，避免序列化丢失包装字段或元数据；不要为修复一个接口而批量补全无关路由的 schema。
- 前端请求集中在 `app/features/<module>/api.ts`，优先使用 `app/lib/api-client.ts` 的 `getJson`、`postJson` 等封装，复用管理接口路径、会话、CSRF 和错误处理。文件上传、流式等特殊请求沿用现有 `adminFetch` 用法。
- API 客户端接收业务相对路径，管理接口由底层处理 `/api/admin/` 前缀；不要直接把服务端 `/api/v1/` 路径复制到门户调用。
- 有响应 Schema 时传给客户端作运行时验证。沿用模块现有 React Query 查询键，写入成功后更新或失效相关缓存。

现有笔记详情接口可作为接入示例：

```typescript
import { getJson } from '@/app/lib/api-client';
import { CreativeNoteSchema, type CreativeNote } from '@sthstart/contracts';

export function fetchNoteDetail(id: string): Promise<CreativeNote> {
  return getJson<CreativeNote>(
    'notebook/notes/' + encodeURIComponent(id), undefined, CreativeNoteSchema,
  );
}
```

## 必要验证

- 契约有改动时运行 `npm run test:contracts`；业务逻辑有改动时运行对应服务测试，例如 `node --import tsx/esm --test apps/service/src/topics.test.ts`，替换为实际受影响的测试文件。
- 接口字段或跨层调用有变化时运行 `npm run typecheck`。覆盖本次改变的成功、错误或兼容行为；不要仅为新增内部类型运行整套构建和测试。
