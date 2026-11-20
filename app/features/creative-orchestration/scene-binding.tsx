import React from 'react';
import type { CreativeScope } from '@sthstart/contracts';
import { Select } from '@/app/components/ui/select';
import { Alert } from '@/app/components/ui/alert';
import { useAcceptedScenes } from './queries';

export type SceneBinding = {
  importance: 'unknown' | 'ordinary' | 'key' | 'baseline';
  sceneArtifactId?: string;
  sceneArtifactHash?: string;
};
export function SceneBindingFields({
  scope,
  value,
  onChange,
}: {
  scope: CreativeScope;
  value: SceneBinding;
  onChange: (value: SceneBinding) => void;
}) {
  const query = useAcceptedScenes(scope);
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 font-medium">插图对应的故事内容</legend>
      <label className="co-field">
        已采用场景
        <Select
          value={value.sceneArtifactId ?? ''}
          disabled={query.pending}
          onChange={(event) => {
            const scene = query.scenes.find((item) => item.id === event.target.value);
            onChange({ ...value, sceneArtifactId: scene?.id, sceneArtifactHash: scene?.contentHash });
          }}
        >
          <option value="">暂不绑定场景，保留人工确认</option>
          {query.scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              {typeof scene.content.title === 'string' ? scene.content.title : '已采用场景'} ·{' '}
              {new Date(scene.createdAt).toLocaleString('zh-CN')}
            </option>
          ))}
        </Select>
      </label>
      <label className="co-field">
        这张图的重要性
        <Select
          value={value.importance}
          onChange={(event) =>
            onChange({ ...value, importance: event.target.value as SceneBinding['importance'] })
          }
        >
          <option value="unknown">尚未判断，人工确认</option>
          <option value="ordinary">普通场景插图</option>
          <option value="key">关键剧情图片</option>
          <option value="baseline">人物定妆 / 地点基准</option>
        </Select>
      </label>
      <p className="text-xs leading-relaxed text-muted">
        仅普通插图、已授权场景和全部审核条件同时满足时才可自动采用。默认由你确认。
      </p>
      {query.error && <Alert variant="danger">{query.error.message}</Alert>}
    </fieldset>
  );
}
