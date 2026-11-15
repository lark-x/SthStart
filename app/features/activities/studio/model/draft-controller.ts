import type { ContentDocument } from '@sthstart/contracts';

export interface StudioDraftController {
  document: ContentDocument | null;
  status: 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';
  error: string | null;
  update(document: ContentDocument): void;
  flush(): Promise<boolean>;
  resolve(server: { document: ContentDocument; draftVersion: number }, keepLocal: boolean): void;
  adoptBeatMedia(
    server: { document: ContentDocument; draftVersion: number },
    target: { stageId: string; sceneId: string; beatId: string },
  ): Promise<void>;
  version(): number;
  isClean(): boolean;
  retry(): void;
}
