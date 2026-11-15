import type {
  Activity,
  ActivitySlotVisualPreview,
  ContentDocument,
  GenerationPreset,
  ImageConfigDocument,
  MediaRevision,
  PromptCompilation,
  PromptRecipe,
  SlotImageConfig,
  SourceRef,
} from '@sthstart/contracts';
import type { WorkbenchNotice } from './model/workbench-status';

export interface ImageWorkbenchProps {
  isOpen: boolean;
  onClose: () => void;
  activity: Activity;
  document: ContentDocument;
  initialSlotId?: string;
  currentMediaRevision?: MediaRevision | null;
  onAdoptSlotAsset?: (slotId: string, assetKey: string) => Promise<void>;
  onLocateField?: (entityKind: string, entityId: string, fieldPath: string) => void;
  registerFlush?(flush: (() => Promise<boolean>) | null): void;
}

export type ImageConfigEditorState = {
  currentConfigDoc: ImageConfigDocument | null;
  baseRevisionId: string | null;
  activeSlotConfig: SlotImageConfig;
  parametersValid: boolean;
  setParametersValid(value: boolean): void;
  visualPreview: ActivitySlotVisualPreview | null;
  isSavingDraft: boolean;
  isCommittingRevision: boolean;
  hasSaveConflict: boolean;
  updateSlotConfig(patch: Partial<SlotImageConfig>): void;
  updateGlobalConfig(patch: Partial<ImageConfigDocument>): void;
  saveDraft(): Promise<boolean>;
  flushConfig(): Promise<boolean>;
  commitRevision(): Promise<import('@sthstart/contracts').ImageConfigRevision | null>;
  commitRevisionForPreparation(): Promise<import('@sthstart/contracts').ImageConfigRevision | null>;
  clearRecovery(): void;
};

export type PreparedPrompt = {
  recipe: PromptRecipe;
  compilation: PromptCompilation;
};

export type GenerationPresetOption = GenerationPreset;

export type WorkbenchSetNotice = (notice: WorkbenchNotice | null) => void;
export type WorkbenchSetSource = (source: SourceRef | null) => void;
