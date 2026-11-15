import type { ReactNode } from 'react';

export interface NoteAdoptionContext {
  noteId: string;
  disabled: boolean;
}

/** 上层装配“加入项目”等跨模块动作的插槽；笔记模块不反向依赖项目模块。 */
export type NoteAdoptAction = (context: NoteAdoptionContext) => ReactNode;
