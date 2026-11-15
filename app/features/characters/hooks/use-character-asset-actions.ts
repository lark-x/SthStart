'use client';

import type { ChangeEvent } from 'react';
import { useToast } from '@/app/providers/ui-provider';
import { exportTavernCard } from '../api';
import { useFetchAvatarFromUrl, useSetCharacterActiveAsset, useUploadCharacterAsset } from '../mutations';

type AssetRefetch = () => Promise<unknown>;

/** 角色素材的写操作：上传、设为当前、链接导入与酒馆卡导出。 */
export function useCharacterAssetActions({
  characterId,
  refetchDetail,
  refetchAssets,
}: {
  characterId?: string;
  refetchDetail: AssetRefetch;
  refetchAssets: AssetRefetch;
}) {
  const toast = useToast();
  const uploadAssetMutation = useUploadCharacterAsset();
  const setActiveAssetMutation = useSetCharacterActiveAsset();
  const fetchAvatarFromUrlMutation = useFetchAvatarFromUrl();

  const handleUploadAsset = async (event: ChangeEvent<HTMLInputElement>, kind: 'avatar' | 'portrait') => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !characterId) return;
    try {
      await uploadAssetMutation.mutateAsync({ id: characterId, file, kind, setAsActive: true });
      toast.success(`${kind === 'portrait' ? '立绘' : '头像'}上传成功`);
      await Promise.all([refetchDetail(), refetchAssets()]);
    } catch (err) {
      toast.error(`${kind === 'portrait' ? '立绘' : '头像'}上传失败`, err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetActiveAsset = async (assetId: string, kind: 'avatar' | 'portrait') => {
    if (!characterId) return;
    try {
      await setActiveAssetMutation.mutateAsync({ id: characterId, payload: { assetId, kind } });
      toast.success(`已切换当前${kind === 'portrait' ? '主立绘' : '主头像'}`);
      await Promise.all([refetchDetail(), refetchAssets()]);
    } catch (err) {
      toast.error(`切换${kind === 'portrait' ? '立绘' : '头像'}失败`, err instanceof Error ? err.message : String(err));
    }
  };

  /** 成功时返回 true，由调用方关闭并清理链接输入框。 */
  const importAvatarFromUrl = async (url: string) => {
    if (!characterId) {
      toast.warning('请先保存角色档案后再抓取头像');
      return false;
    }
    if (!url.trim()) return false;
    try {
      await fetchAvatarFromUrlMutation.mutateAsync({ id: characterId, url: url.trim() });
      toast.success('已成功从链接导入头像');
      await refetchDetail();
      return true;
    } catch (err: unknown) {
      toast.error('从链接导入头像失败', err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const exportTavern = async (displayName: string) => {
    if (!characterId) return;
    try {
      const card = await exportTavernCard(characterId);
      const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${displayName || 'character'}_tavern_card.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('已导出标准酒馆角色卡 (JSON)');
    } catch (err: unknown) {
      toast.error('导出酒馆卡失败', err instanceof Error ? err.message : String(err));
    }
  };

  return {
    handleUploadAsset,
    handleSetActiveAsset,
    importAvatarFromUrl,
    exportTavern,
    isUploading: uploadAssetMutation.isPending,
    isSettingActive: setActiveAssetMutation.isPending,
    isImportingUrlAvatar: fetchAvatarFromUrlMutation.isPending,
  };
}
