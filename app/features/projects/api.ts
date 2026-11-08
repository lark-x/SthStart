import { getJson, postJson, deleteJson } from "@/app/lib/api-client";
import {
  ProjectListSchema,
  ProjectPageSchema,
  type ProjectPage,
  type ProjectListQuery,
  ProjectOverviewSchema,
  ProjectLinkSchema,
  AdoptProjectLinkResponseSchema,
  type ProjectList,
  type ProjectOverview,
  type ProjectLink,
  type AddProjectLink,
  type StoryDocument,
} from "@sthstart/contracts";
const path = (id: string) => "projects/" + encodeURIComponent(id);
export const projectsApi = {
  list: () => getJson<ProjectList>("projects", undefined, ProjectListSchema),
  page: (query: ProjectListQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return getJson<ProjectPage>('projects/page?' + params.toString(), { signal }, ProjectPageSchema);
  },
  overview: (id: string) =>
    getJson<ProjectOverview>(
      path(id) + "/overview",
      undefined,
      ProjectOverviewSchema,
    ),
  add: (id: string, source: AddProjectLink) =>
    postJson<ProjectLink>(
      path(id) + "/links",
      source,
      undefined,
      ProjectLinkSchema,
    ),
  adopt: (id: string, linkId: string) =>
    postJson<{ document: StoryDocument }>(
      path(id) + "/links/" + encodeURIComponent(linkId) + "/adopt",
      {},
      undefined,
      AdoptProjectLinkResponseSchema,
    ),
  unlink: (id: string, linkId: string) =>
    deleteJson<void>(path(id) + "/links/" + encodeURIComponent(linkId)),
};
