import type { ReactNode } from 'react';
import type {
  WorldActor,
  WorldLocation,
  WorldEvent,
  WorldImage,
  WorldBranch,
  WorldActorState,
} from '@sthstart/contracts';

export type WorldFact = WorldEvent['facts'][number];
export type WorldPerspective = WorldEvent['perspectives'][number];

/**
 * Props for WorldReader (Story / Continuous Prose Reading).
 * Supports continuous chronological reading by actor or story line,
 * perspective switching anchored on the same event reference,
 * facts with information boundary provenance, character state evolution,
 * and attached non-blocking visual previews.
 */
export interface WorldReaderProps {
  events: WorldEvent[];
  actors: WorldActor[];
  locations: WorldLocation[];
  images?: WorldImage[];
  actorId?: string;
  onSelectEvent?: (id: string) => void;
  selectedEventId?: string;
  className?: string;
}

export interface WorldImageAdoptInput {
  image: WorldImage;
  event: WorldEvent;
  artifactId: string;
  disabled: boolean;
}

export type WorldImageAdoptAction = (input: WorldImageAdoptInput) => ReactNode;

/**
 * Props for WorldImageReader (Visual Narrative Storyboard).
 * Organizes scenes by 3 phases: establishing, action, result.
 * Truthfully displays planned, queued, running, succeeded, failed, uncertain, and stale statuses.
 * Visual layout never obstructs readable story text.
 */
export interface WorldImageReaderProps {
  events: WorldEvent[];
  actors: WorldActor[];
  locations: WorldLocation[];
  images?: WorldImage[];
  actorId?: string;
  onSelectEvent?: (id: string) => void;
  selectedEventId?: string;
  adoptAction?: WorldImageAdoptAction;
  className?: string;
}

/**
 * Props for WorldEventDetail (Single Event In-Depth Inspector).
 * Explores participant information boundaries, subjective perspectives,
 * world facts with source nature, character emotional/relationship changes,
 * and full visual generation prompts/notes.
 */
export interface WorldEventDetailProps {
  event: WorldEvent;
  actors: WorldActor[];
  locations: WorldLocation[];
  images: WorldImage[];
  onClose?: () => void;
  onSelectEvent?: (id: string) => void;
  className?: string;
}

/**
 * Branch payload for side-by-side comparison.
 */
export interface WorldBranchSideData {
  branch: WorldBranch;
  events: WorldEvent[];
  images?: WorldImage[];
  actors?: WorldActor[];
  locations?: WorldLocation[];
}

/**
 * Props for WorldBranchComparison.
 * Side-by-side branch comparison supporting canon-gap (原作留白),
 * adaptation (原作改编), and alternate (平行世界) modes.
 * Branch images are strictly partitioned without cross-contamination.
 */
export interface WorldBranchComparisonProps {
  left: WorldBranchSideData;
  right: WorldBranchSideData;
  actors: WorldActor[];
  locations: WorldLocation[];
  onSelectEvent?: (eventId: string, branchId: string) => void;
  className?: string;
}

export type ImagePhase = 'establishing' | 'action' | 'result';
export type ImageStatus =
  | 'planned'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'uncertain'
  | 'stale';
export type SourceNature = 'canon' | 'author' | 'ai' | 'unverified';
export type BranchMode = 'canon-gap' | 'adaptation' | 'alternate';
