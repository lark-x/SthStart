'use client';

import { Suspense } from 'react';
import { ResourcesWorkspace } from '@/app/features/resources/resources-workspace';
import { Spinner } from '@/app/components/ui/spinner';

export function ResourcesClient() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted" />
        </div>
      }
    >
      <ResourcesWorkspace />
    </Suspense>
  );
}
