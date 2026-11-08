import { Type, type Static } from "@sinclair/typebox";
import {
  StoryProjectSchema,
  StoryDocumentSchema,
  StoryCharacterSchema,
} from "./story.js";

export const ProjectSourceKindSchema = Type.Union([
  Type.Literal("note"),
  Type.Literal("narrative"),
  Type.Literal("topic"),
  Type.Literal("collection"),
  Type.Literal("artifact"),
  Type.Literal("activity"),
]);
export const AddProjectLinkSchema = Type.Object(
  {
    kind: ProjectSourceKindSchema,
    id: Type.String({ minLength: 1, maxLength: 512 }),
    usage: Type.Optional(
      Type.Union([Type.Literal("background"), Type.Literal("requirement")]),
    ),
  },
  { additionalProperties: false },
);
export type AddProjectLink = Static<typeof AddProjectLinkSchema>;
export const ProjectLinkSchema = Type.Object({
  id: Type.String(),
  kind: ProjectSourceKindSchema,
  sourceId: Type.String(),
  title: Type.String(),
  excerpt: Type.String(),
  nature: Type.String(),
  authorship: Type.String(),
  sourceVersion: Type.Union([Type.String(), Type.Null()]),
  usage: Type.String(),
  capturedAt: Type.String(),
  sourceHref: Type.String(),
  state: Type.Union([
    Type.Literal("unchanged"),
    Type.Literal("updated"),
    Type.Literal("missing"),
  ]),
  truncated: Type.Boolean(),
  adoptedEntryId: Type.Union([Type.String(), Type.Null()]),
});
export type ProjectLink = Static<typeof ProjectLinkSchema>;
export const ProjectProductionSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  type: Type.String(),
  updatedAt: Type.String(),
});
export const ProjectOverviewSchema = Type.Object({
  project: StoryProjectSchema,
  documents: Type.Array(StoryDocumentSchema),
  characters: Type.Array(
    Type.Intersect([
      StoryCharacterSchema,
      Type.Object({
        latestSourceVersion: Type.Union([Type.Integer(), Type.Null()]),
      }),
    ]),
  ),
  links: Type.Array(ProjectLinkSchema),
  productions: Type.Array(ProjectProductionSchema),
});
export type ProjectOverview = Static<typeof ProjectOverviewSchema>;
export const AdoptProjectLinkResponseSchema = Type.Object({
  document: StoryDocumentSchema,
});
export const ProjectListSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      project: StoryProjectSchema,
      chapters: Type.Integer(),
      characters: Type.Integer(),
      references: Type.Integer(),
      productions: Type.Integer(),
    }),
  ),
});
export type ProjectList = Static<typeof ProjectListSchema>;

export const ProjectSortSchema = Type.Union([
  Type.Literal('updated'), Type.Literal('created'), Type.Literal('title'),
]);
export const ProjectListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  q: Type.Optional(Type.String({ maxLength: 200 })),
  sort: Type.Optional(ProjectSortSchema),
}, { additionalProperties: false });
export type ProjectListQuery = Static<typeof ProjectListQuerySchema>;
export const ProjectPageSchema = Type.Object({
  items: ProjectListSchema.properties.items,
  total: Type.Integer({ minimum: 0 }),
  page: Type.Integer({ minimum: 1 }),
  pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
});
export type ProjectPage = Static<typeof ProjectPageSchema>;
