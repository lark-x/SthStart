---
name: contract-first-api
description: >-
  Use this skill when adding or modifying API endpoints, data models, or service routes in SthStart.
  Enforces the contract-first workflow across packages/contracts, apps/service, and app/features.
---

# 契约驱动 API 开发指南 (Contract-First API)

在 SthStart 中新增或变更任何 API 接口与数据模型时，必须严格遵循“契约先行”规范。严禁直接在前端或服务端手写未经 `packages/contracts` 导出的临时类型。

---

## 核心流程速览

```text
1. 定义契约 (packages/contracts)
   └── TypeBox Schema + Static TypeScript 类型导出
        ↓
2. 服务端实现 (apps/service)
   └── Fastify 路由注入校验 + Store 实现 + 靶向单测
        ↓
3. 前端接入 (app/features)
   └── 引用契约类型 + @tanstack/react-query 封装 Hooks
```

---

## 具体开发步骤

### 第一步：契约定义 (`packages/contracts/`)

1. **定位或新建模块契约**：
   - 业务契约位于 `packages/contracts/src/<module>.ts`（如 `activities.ts`、`narrative.ts` 等）。
2. **编写 TypeBox Schema 与类型**：
   ```typescript
   import { Type, type Static } from '@sinclair/typebox';

   export const MyItemSchema = Type.Object({
     id: Type.String(),
     title: Type.String(),
     createdAt: Type.String({ format: 'date-time' }),
   });
   export type MyItem = Static<typeof MyItemSchema>;

   export const CreateMyItemRequestSchema = Type.Object({
     title: Type.String({ minLength: 1 }),
   });
   export type CreateMyItemRequest = Static<typeof CreateMyItemRequestSchema>;
   ```
3. **在入口统一导出**：
   - 打开 `packages/contracts/src/index.ts`，重新导出新定义的 Schema 与类型：
     ```typescript
     export * from './<module>.js';
     ```
4. **靶向验证契约**：
   ```bash
   npm run test:contracts
   ```

---

### 第二步：服务端实现 (`apps/service/`)

1. **引入契约并配置 Fastify 路由校验**：
   - 路由文件位于 `apps/service/src/<module>/routes.ts`。
   - 利用 Fastify 对 TypeBox 的原生支持，在路由定义中传入 Schema 进行运行时入参/出参校验：
     ```typescript
     import { CreateMyItemRequestSchema, MyItemSchema } from '@sthstart/contracts';
     import type { FastifyPluginAsync } from 'fastify';

     export const myRoutes: FastifyPluginAsync = async (fastify) => {
       fastify.post('/api/v1/my-items', {
         schema: {
           body: CreateMyItemRequestSchema,
           response: {
             200: MyItemSchema,
           },
         },
       }, async (request, reply) => {
         // request.body 会自动根据 Schema 完成类型推导与校验
         const result = await store.create(request.body);
         return result;
       });
     };
     ```
2. **Store 数据层实现**：
   - 实体存储通常位于 `apps/service/src/<module>/store.ts`，操作 SQLite 或内存状态。
3. **编写与运行单测**：
   - 在 `apps/service/src/<module>.test.ts` 中补充接口测试。
   - **快速靶向运行单测（无需全量构建）**：
     ```bash
     node --import tsx/esm --test apps/service/src/<module>.test.ts
     ```

---

### 第三步：前端接入 (`app/features/`)

1. **封装 API 请求**：
   - 在 `app/features/<module>/api.ts` 中直接引入 contracts 类型：
     ```typescript
     import type { CreateMyItemRequest, MyItem } from '@sthstart/contracts';

     export async function createMyItem(payload: CreateMyItemRequest): Promise<MyItem> {
       const res = await fetch('/api/v1/my-items', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(payload),
       });
       if (!res.ok) throw new Error(`Failed to create item: ${res.statusText}`);
       return res.json();
     }
     ```
2. **封装 React Query Hook**：
   - 在 `app/features/<module>/mutations.ts` 或 `queries.ts`：
     ```typescript
     import { useMutation, useQueryClient } from '@tanstack/react-query';
     import { createMyItem } from './api';

     export function useCreateMyItem() {
       const queryClient = useQueryClient();
       return useMutation({
         mutationFn: createMyItem,
         onSuccess: () => {
           queryClient.invalidateQueries({ queryKey: ['my-items'] });
         },
       });
     }
     ```
3. **UI 组件使用**：
   - 在页面或组件中直接调用该 Hook，禁止在 UI 组件内部散落 `fetch`。

---

## 验证检查表 (Verification Checklist)

- [ ] 契约测试通过：`npm run test:contracts`
- [ ] 服务端靶向单测通过：`node --import tsx/esm --test apps/service/src/<module>.test.ts`
- [ ] 全局类型检查通过：`npm run typecheck`
