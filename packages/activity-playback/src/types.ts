
export interface StateAtTimeResult {
  tMs: number;
  view: 'chat' | 'moments';
  conversationId?: string;
  scrollY: number;
  visibleThroughOrder: number;
  activeMediaModal: {
    slotId: string;
    assetKey: string;
    kind: 'image' | 'video';
    sourceInMs: number;
    volume: number;
  } | null;
  stageCardText: string | null;
  navTitle: string;
}

export interface CompiledHyperFramesProject {
  html: string;
  assets: {
    sourcePath?: string;
    targetPath: string;
    content?: string | Buffer;
  }[];
  manifest: {
    schemaVersion: 1;
    templateId: string;
    templateVersion: string;
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
  };
}
