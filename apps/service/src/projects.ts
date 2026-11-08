import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  AddProjectLinkSchema,
  ProjectListSchema,
  ProjectPageSchema,
  ProjectListQuerySchema,
  type ProjectPage,
  type ProjectListQuery,
  ProjectOverviewSchema,
  ProjectLinkSchema,
  AdoptProjectLinkResponseSchema,
  type AddProjectLink,
  type ProjectLink,
  type ProjectOverview,
  type PlanningKnowledgeReference,
  type ProjectList,
} from "@sthstart/contracts";
import { authenticateAdmin } from "./access.js";
import type { ServiceConfig } from "./config.js";
import { nowIso, type ServiceDatabase } from "./database.js";
import type { NarrativeDatabase } from "./narrative-database.js";
import { checkReferences, resolveReference } from "./knowledge/references.js";
import { KnowledgeStore, contentHashOf } from "./knowledge/store.js";
import {
  createArtifactReference,
  resolveArtifactStoragePath,
} from "./artifacts.js";
import { StoryError, StoryStore } from "./story/store.js";

type LinkRow = {
  id: string;
  project_id: string;
  kind: AddProjectLink["kind"];
  source_id: string;
  snapshot_json: string;
  captured_at: string;
  adopted_entry_id: string | null;
};
type Snapshot = {
  title: string;
  excerpt?: string;
  appId?: string;
  reference?: PlanningKnowledgeReference;
};
const productionQuery =
  "SELECT a.id,a.title,a.type,a.updated_at AS updatedAt FROM activities a WHERE a.archived=0 AND (a.id IN (SELECT activity_id FROM publication_drafts WHERE project_id=?1) OR a.id IN (SELECT source_id FROM project_links WHERE project_id=?1 AND kind='activity')) ORDER BY a.updated_at DESC";
export class ProjectStore {
  readonly story: StoryStore;
  constructor(
    readonly database: ServiceDatabase,
    readonly narrativeDatabase: NarrativeDatabase | null = null,
    readonly artifactDirectory?: string,
  ) {
    this.story = new StoryStore(database);
    // SQLite lower() is ASCII-only; preserve the former JavaScript search's Unicode folding.
    database.connection.function('project_search_fold', { deterministic: true }, value => String(value ?? '').toLowerCase());
  }
  private row(projectId: string, id: string) {
    this.story.requireProject(projectId);
    const row = this.database.connection
      .prepare("SELECT * FROM project_links WHERE project_id=? AND id=?")
      .get(projectId, id) as LinkRow | undefined;
    if (!row)
      throw new StoryError("project_link_not_found", 404, "项目引用不存在。");
    return row;
  }
  list(): ProjectList {
    return this.summarize(this.story.listProjects().filter(p => p.projectType !== 'reflection'));
  }
  /** Query before summarizing so counts and related data are read for one page only. */
  page(input: ProjectListQuery): ProjectPage {
    const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize || 20)));
    const requestedPage = Math.max(1, Math.floor(input.page || 1));
    // instr treats %, _ and backslashes as literal text, matching client search semantics.
    const where = "COALESCE(project_type, 'fiction') <> 'reflection' AND instr(project_search_fold(title || summary), ?) > 0";
    const search = (input.q ?? '').trim().toLowerCase();
    const total = Number((this.database.connection.prepare(`SELECT COUNT(*) n FROM story_projects WHERE ${where}`).get(search) as { n: number }).n);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const order = input.sort === 'title' ? 'title COLLATE NOCASE ASC,id ASC'
      : input.sort === 'created' ? 'created_at DESC,id ASC' : 'updated_at DESC,id ASC';
    const rows = this.database.connection.prepare(`SELECT id FROM story_projects WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(search, pageSize, (page - 1) * pageSize) as { id: string }[];
    return { ...this.summarize(rows.map(row => this.story.requireProject(row.id))), total, page, pageSize };
  }
  private summarize(projects: ProjectList['items'][number]['project'][]): ProjectList {
    return {
      items: projects.map((project) => {
          const count = (sql: string) =>
            Number(
              (
                this.database.connection.prepare(sql).get(project.id) as {
                  n: number;
                }
              ).n,
            );
          return {
            project,
            chapters: count(
              "SELECT COUNT(*) n FROM story_documents WHERE project_id=? AND kind='chapter'",
            ),
            characters: count(
              "SELECT COUNT(*) n FROM story_characters WHERE project_id=?",
            ),
            references: count(
              "SELECT COUNT(*) n FROM project_links WHERE project_id=? AND kind NOT IN ('artifact','activity')",
            ),
            productions: this.database.connection
              .prepare(productionQuery)
              .all(project.id).length,
          };
        }),
    };
  }
  private serialize(row: LinkRow): ProjectLink {
    const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
    const reference = snapshot.reference;
    let state: ProjectLink["state"] = "unchanged";
    if (reference)
      state = checkReferences(this, {
        schemaVersion: 1,
        capturedAt: row.captured_at,
        references: [reference],
      }).items[0].state;
    else if (row.kind === "artifact") {
      const file = this.database.connection
        .prepare("SELECT file_status FROM artifacts WHERE id=?")
        .get(row.source_id) as { file_status: string } | undefined;
      if (!file || file.file_status !== "ready") state = "missing";
      if (state !== "missing" && this.artifactDirectory) {
        const path = resolveArtifactStoragePath(
          this.database,
          row.source_id,
          this.artifactDirectory,
        );
        if (!path || !existsSync(path)) state = "missing";
      }
    } else if (
      !this.database.connection
        .prepare("SELECT id FROM activities WHERE id=? AND archived=0")
        .get(row.source_id)
    )
      state = "missing";
    const id = encodeURIComponent(row.source_id);
    const sourceHref =
      row.kind === "note"
        ? "/apps/notebook/" + id
        : row.kind === "topic"
          ? "/apps/inspiration?topic=" + id
          : row.kind === "narrative"
            ? "/apps/narrative?work=" +
              encodeURIComponent(String(reference?.locator?.workId ?? "")) +
              "&node=" +
              encodeURIComponent(String(reference?.locator?.nodeId ?? ""))
            : row.kind === "collection"
              ? "/apps/notebook?view=collections"
              : row.kind === "artifact"
                ? "/apps/media?q=" + id
                : "/apps/activities/" + id;
    return {
      id: row.id,
      kind: row.kind,
      sourceId: row.source_id,
      title: snapshot.title,
      excerpt: reference?.excerpt ?? snapshot.excerpt ?? "",
      nature: reference?.nature ?? "",
      authorship: reference?.authorship ?? "",
      sourceVersion: reference?.sourceVersion ?? null,
      usage: reference?.usage ?? "background",
      capturedAt: row.captured_at,
      sourceHref,
      state,
      truncated: reference?.truncated ?? false,
      adoptedEntryId: row.adopted_entry_id,
    };
  }
  overview(projectId: string): ProjectOverview {
    const project = this.story.requireProject(projectId);
    const links = (
      this.database.connection
        .prepare(
          "SELECT * FROM project_links WHERE project_id=? ORDER BY captured_at DESC,id",
        )
        .all(projectId) as LinkRow[]
    ).map((row) => this.serialize(row));
    const characters = this.story
      .listCharacters(projectId)
      .map((c) => ({
        ...c,
        latestSourceVersion: c.sourceCharacterId
          ? (
              this.database.connection
                .prepare(
                  "SELECT MAX(version) v FROM character_versions WHERE character_id=?",
                )
                .get(c.sourceCharacterId) as { v: number | null }
            ).v
          : null,
      }));
    const productions = this.database.connection
      .prepare(productionQuery)
      .all(projectId) as ProjectOverview["productions"];
    return {
      project,
      documents: this.story.listDocuments(projectId),
      characters,
      links,
      productions,
    };
  }
  add(projectId: string, input: AddProjectLink): ProjectLink {
    this.story.requireProject(projectId);
    const existing = this.database.connection
      .prepare(
        "SELECT * FROM project_links WHERE project_id=? AND kind=? AND source_id=?",
      )
      .get(projectId, input.kind, input.id) as LinkRow | undefined;
    if (existing) return this.serialize(existing);
    let snapshot: Snapshot;
    if (input.kind === "artifact") {
      const file = this.database.connection
        .prepare("SELECT app_id,original_name FROM artifacts WHERE id=?")
        .get(input.id) as { app_id: string; original_name: string } | undefined;
      if (!file)
        throw new StoryError("project_source_missing", 404, "媒体不存在。");
      snapshot = {
        title: file.original_name || "媒体文件",
        appId: file.app_id,
      };
    } else if (input.kind === "activity") {
      const source = this.database.connection
        .prepare("SELECT title FROM activities WHERE id=? AND archived=0")
        .get(input.id) as { title: string } | undefined;
      if (!source)
        throw new StoryError("project_source_missing", 404, "制作不存在。");
      const owner = this.database.connection
        .prepare(
          "SELECT project_id FROM publication_drafts WHERE activity_id=?",
        )
        .get(input.id) as { project_id: string } | undefined;
      if (owner && owner.project_id !== projectId)
        throw new StoryError(
          "project_source_conflict",
          409,
          "该制作版本来自其他项目，不能改变其来源。",
        );
      snapshot = { title: source.title };
    } else {
      const reference = resolveReference(
        this,
        {
          sourceKind: input.kind,
          sourceId: input.id,
          usage: input.usage ?? "background",
        },
        new KnowledgeStore(this.database),
      );
      if (!reference)
        throw new StoryError(
          "project_source_missing",
          404,
          "来源不存在或暂无可参考内容。",
        );
      if (reference.excerpt.length > 12000) {
        reference.sourceContentHash ??= reference.contentHash;
        reference.excerpt = reference.excerpt.slice(0, 12000);
        reference.contentHash = contentHashOf(reference.excerpt);
        reference.truncated = true;
      }
      snapshot = { title: reference.title, reference };
    }
    const id = randomUUID();
    const capturedAt = nowIso();
    this.database.transaction(() => {
      this.database.connection
        .prepare(
          "INSERT INTO project_links(id,project_id,kind,source_id,snapshot_json,captured_at) VALUES (?,?,?,?,?,?)",
        )
        .run(
          id,
          projectId,
          input.kind,
          input.id,
          JSON.stringify(snapshot),
          capturedAt,
        );
      if (input.kind === "artifact")
        createArtifactReference(this.database, {
          artifactId: input.id,
          appId: snapshot.appId!,
          refType: "project",
          refId: id,
        });
    });
    return this.serialize(this.row(projectId, id));
  }
  adopt(projectId: string, id: string) {
    const row = this.row(projectId, id);
    if (row.adopted_entry_id) {
      const document = this.story.getDocument(projectId, row.adopted_entry_id);
      if (document) return { document };
    }
    const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
    if (!snapshot.reference)
      throw new StoryError(
        "project_reference_required",
        400,
        "只有文字资料可以采用为设定。",
      );
    const source = this.serialize(row);
    const body =
      source.excerpt +
      "\n\n---\n采用来源：" +
      source.title +
      "\n来源性质：" +
      source.nature +
      "；作者类型：" +
      source.authorship +
      "\n来源版本：" +
      (source.sourceVersion ?? snapshot.reference.contentHash.slice(0, 16)) +
      "\n采纳时间：" +
      source.capturedAt +
      "\n来源标识：" +
      row.kind +
      "/" +
      row.source_id +
      "\n此内容已成为本项目设定；来源更新不会自动覆盖作者的修改。";
    const document = this.story.createDocument(
      projectId,
      { kind: "world", title: source.title.slice(0, 120), body },
      (created) => {
        this.database.connection
          .prepare(
            "UPDATE project_links SET adopted_entry_id=? WHERE id=? AND project_id=?",
          )
          .run(created.id, id, projectId);
      },
    );
    return { document };
  }
  unlink(projectId: string, id: string) {
    const row = this.row(projectId, id);
    if (row.adopted_entry_id)
      throw new StoryError(
        "project_reference_adopted",
        409,
        "已采用的设定保留来源引用。",
      );
    this.database.transaction(() => {
      if (row.kind === "artifact")
        this.database.connection
          .prepare(
            "DELETE FROM artifact_references WHERE ref_type='project' AND ref_id=? AND artifact_id=?",
          )
          .run(id, row.source_id);
      this.database.connection
        .prepare("DELETE FROM project_links WHERE id=? AND project_id=?")
        .run(id, projectId);
    });
  }
}

export function registerProjectRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
  narrativeDatabase: NarrativeDatabase | null,
) {
  const store = new ProjectStore(
    database,
    narrativeDatabase,
    config.artifactDirectory,
  );
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.adminToken)
      return reply.code(503).send({ error: "admin_not_configured" });
    if (config.adminToken && !authenticateAdmin(config.adminToken, request))
      return reply.code(401).send({ error: "unauthorized" });
  };
  const run = <T>(reply: FastifyReply, operation: () => T) => {
    try {
      return operation();
    } catch (e) {
      if (e instanceof StoryError)
        return reply
          .code(e.statusCode)
          .send({ error: e.code, message: e.message });
      throw e;
    }
  };
  const params = Type.Object({ projectId: Type.String() });
  const itemParams = Type.Object({
    projectId: Type.String(),
    id: Type.String(),
  });
  app.get(
    "/api/v1/admin/projects",
    { preHandler: guard, schema: { response: { 200: ProjectListSchema } } },
    () => store.list(),
  );
  app.get<{ Querystring: ProjectListQuery }>(
    '/api/v1/admin/projects/page',
    { preHandler: guard, schema: { querystring: ProjectListQuerySchema, response: { 200: ProjectPageSchema } } },
    (req, reply) => run(reply, () => store.page(req.query)),
  );
  app.get<{ Params: { projectId: string } }>(
    "/api/v1/admin/projects/:projectId/overview",
    {
      preHandler: guard,
      schema: { params, response: { 200: ProjectOverviewSchema } },
    },
    (req, reply) => run(reply, () => store.overview(req.params.projectId)),
  );
  app.post<{ Params: { projectId: string }; Body: AddProjectLink }>(
    "/api/v1/admin/projects/:projectId/links",
    {
      preHandler: guard,
      schema: {
        params,
        body: AddProjectLinkSchema,
        response: { 200: ProjectLinkSchema },
      },
    },
    (req, reply) => run(reply, () => store.add(req.params.projectId, req.body)),
  );
  app.post<{ Params: { projectId: string; id: string } }>(
    "/api/v1/admin/projects/:projectId/links/:id/adopt",
    {
      preHandler: guard,
      schema: {
        params: itemParams,
        body: Type.Object({}),
        response: { 200: AdoptProjectLinkResponseSchema },
      },
    },
    (req, reply) =>
      run(reply, () => store.adopt(req.params.projectId, req.params.id)),
  );
  app.delete<{ Params: { projectId: string; id: string } }>(
    "/api/v1/admin/projects/:projectId/links/:id",
    { preHandler: guard, schema: { params: itemParams } },
    (req, reply) =>
      run(reply, () => {
        store.unlink(req.params.projectId, req.params.id);
        return reply.code(204).send();
      }),
  );
}
