'use client';

import { useQueryClient } from '@tanstack/react-query';
import type {
  CreateWorldBranch,
  CreateWorldIntervention,
  CreateWorldStoryLine,
  BindWorldProject,
  GenerationRecoveryResolveRequest,
  PlanWorldImages,
  PromoteWorldActor,
  RefreshWorldSources,
  ResolveWorldRunCall,
  ResumeWorldRun,
  StartWorldRun,
  SubmitWorldImage,
  WorldAdoption,
  WorldDefinition,
  WorldProjectBinding,
} from '@sthstart/contracts';
import type { WorldRevisionRequest } from '../api';
import { projectKeys } from '@/app/features/projects/query-keys';
import {
  adoptWorldEvents,
  bindWorldProject,
  createWorld,
  createWorldBranch,
  createWorldIntervention,
  createWorldStoryLine,
  pauseWorldRun,
  planWorldImages,
  promoteWorldActor,
  refreshWorldSources,
  resolveRunCall,
  resolveUncertainGenerationTask,
  resumeWorldRun,
  startWorldRun,
  submitWorldImage,
  updateWorld,
} from '../api';
import { storyWorldKeys } from '../query-keys';

function eventsPrefix(worldId: string, branchId: string) {
  return [...storyWorldKeys.all, 'events', worldId, branchId] as const;
}

function memoriesPrefix(worldId: string, branchId: string) {
  return [...storyWorldKeys.all, 'memories', worldId, branchId] as const;
}

export function useStoryWorldActions() {
  const queryClient = useQueryClient();

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: storyWorldKeys.list() });

  const invalidateOverview = (worldId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: storyWorldKeys.overview(worldId) }),
      queryClient.invalidateQueries({ queryKey: [...storyWorldKeys.all, 'hub', worldId] }),
    ]);

  const invalidateBranch = async (worldId: string, branchId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: storyWorldKeys.branch(worldId, branchId) }),
      queryClient.invalidateQueries({ queryKey: storyWorldKeys.hub(worldId, branchId) }),
      queryClient.invalidateQueries({ queryKey: eventsPrefix(worldId, branchId) }),
      queryClient.invalidateQueries({ queryKey: memoriesPrefix(worldId, branchId) }),
      queryClient.invalidateQueries({ queryKey: storyWorldKeys.comparison(worldId, branchId) }),
      queryClient.invalidateQueries({ queryKey: storyWorldKeys.overview(worldId) }),
    ]);
  };

  return {
    createWorld: async (definition: WorldDefinition) => {
      const world = await createWorld(definition);
      await invalidateList();
      return world;
    },
    updateWorld: async (worldId: string, expectedRevision: number, definition: WorldDefinition) => {
      const world = await updateWorld(worldId, expectedRevision, definition);
      await Promise.all([
        invalidateList(),
        invalidateOverview(worldId),
        queryClient.invalidateQueries({ queryKey: [...storyWorldKeys.all, 'branch', worldId] }),
      ]);
      return world;
    },
    createBranch: async (worldId: string, input: CreateWorldBranch) => {
      const branch = await createWorldBranch(worldId, input);
      await invalidateOverview(worldId);
      return branch;
    },
    createStoryLine: async (worldId: string, branchId: string, input: CreateWorldStoryLine) => {
      const line = await createWorldStoryLine(worldId, branchId, input);
      await invalidateBranch(worldId, branchId);
      return line;
    },
    createIntervention: async (worldId: string, branchId: string, input: CreateWorldIntervention) => {
      const intervention = await createWorldIntervention(worldId, branchId, input);
      await invalidateBranch(worldId, branchId);
      return intervention;
    },
    startRun: async (worldId: string, branchId: string, input: StartWorldRun) => {
      const run = await startWorldRun(worldId, branchId, input);
      await invalidateBranch(worldId, branchId);
      return run;
    },
    pauseRun: async (worldId: string, branchId: string, runId: string, input: WorldRevisionRequest) => {
      const run = await pauseWorldRun(worldId, branchId, runId, input);
      await invalidateBranch(worldId, branchId);
      return run;
    },
    resumeRun: async (worldId: string, branchId: string, runId: string, input: ResumeWorldRun) => {
      const run = await resumeWorldRun(worldId, branchId, runId, input);
      await invalidateBranch(worldId, branchId);
      return run;
    },
    planImages: async (worldId: string, branchId: string, input: PlanWorldImages) => {
      const images = await planWorldImages(worldId, branchId, input);
      await invalidateBranch(worldId, branchId);
      return images;
    },
    submitImage: async (worldId: string, branchId: string, imageId: string, input: SubmitWorldImage) => {
      const image = await submitWorldImage(worldId, branchId, imageId, input);
      await invalidateBranch(worldId, branchId);
      return image;
    },
    adoptEvents: async (worldId: string, branchId: string, input: WorldAdoption) => {
      const result = await adoptWorldEvents(worldId, branchId, input);
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      return result;
    },
    bindProject: async (worldId: string, branchId: string, input: BindWorldProject & { expectedBinding?: WorldProjectBinding | null }) => {
      const binding = await bindWorldProject(worldId, branchId, input);
      queryClient.setQueryData(storyWorldKeys.projectBinding(input.projectId), { binding });
      return binding;
    },
    refreshSources: async (worldId: string, branchId: string, input: RefreshWorldSources) => {
      const detail = await refreshWorldSources(worldId, branchId, input);
      queryClient.setQueryData(storyWorldKeys.branch(worldId, branchId), detail);
      await invalidateOverview(worldId);
      return detail;
    },
    promoteActor: async (worldId: string, branchId: string, actorId: string, input: PromoteWorldActor) => {
      const result = await promoteWorldActor(worldId, branchId, actorId, input);
      await invalidateBranch(worldId, branchId);
      return result;
    },
    resolveRunCall: async (worldId: string, branchId: string, runId: string, callId: string, input: ResolveWorldRunCall) => {
      const result = await resolveRunCall(worldId, branchId, runId, callId, input);
      await Promise.all([
        invalidateBranch(worldId, branchId),
        queryClient.invalidateQueries({ queryKey: storyWorldKeys.runRecovery(worldId, branchId, runId) }),
      ]);
      return result;
    },
    resolveUncertainGeneration: async (taskId: string, input: GenerationRecoveryResolveRequest) => {
      const result = await resolveUncertainGenerationTask(taskId, input);
      await queryClient.invalidateQueries({ queryKey: storyWorldKeys.uncertainGeneration() });
      return result;
    },
  };
}
