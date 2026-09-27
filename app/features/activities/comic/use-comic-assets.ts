'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComicDocument } from '@sthstart/contracts';
import type { ComicAssetResolver } from '@sthstart/activity-playback';

export function useComicAssets(document: ComicDocument) {
  const cache = useRef(new Map<string, HTMLImageElement | null>());
  const [revision, setRevision] = useState(0);
  const artifactIds = useMemo(() => [...new Set(document.panels.flatMap((panel) => panel.selectedImage ? [panel.selectedImage.artifactId] : []))], [document.panels]);
  const artifactKey = artifactIds.join('\n');

  useEffect(() => {
    let active = true;
    for (const artifactId of artifactIds) {
      if (cache.current.has(artifactId)) continue;
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => { if (active) setRevision((value) => value + 1); };
      image.onerror = () => {
        cache.current.set(artifactId, null);
        if (active) setRevision((value) => value + 1);
      };
      cache.current.set(artifactId, image);
      image.src = `/api/admin/artifacts/${encodeURIComponent(artifactId)}/file`;
    }
    return () => { active = false; };
    // artifactKey is a stable representation of the image IDs; the image cache is intentionally persistent across page switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactKey]);

  const assets = useMemo<ComicAssetResolver>(() => ({
    getImage: (artifactId) => {
      const image = cache.current.get(artifactId);
      return image && image.complete && image.naturalWidth > 0 ? image : null;
    },
  }), [revision]);
  const missingArtifactIds = artifactIds.filter((artifactId) => cache.current.get(artifactId) === null);
  const loading = artifactIds.some((artifactId) => {
    const image = cache.current.get(artifactId);
    return image === undefined || (image !== null && !image.complete && image.naturalWidth === 0);
  });

  return { assets, loading, missingArtifactIds };
}
