'use client';

import { StoryWorldsWorkspace } from '@/app/features/story-worlds/workspace';
import { worldImageAdoptAction } from './world-image-adopt-action';

export function StoryWorldWorkspace() {
  return <StoryWorldsWorkspace imageAdoptAction={worldImageAdoptAction} />;
}
