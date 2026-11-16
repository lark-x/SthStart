import type { CharacterBrowseQuery, CharacterBrowseResult } from '@sthstart/contracts';

export interface CharacterFilterOption {
  value: string;
  label: string;
  search?: string;
}

export type CharacterFilterMultiKey = 'works' | 'tags' | 'groups';

export interface CharacterFilterMultiControl {
  key: CharacterFilterMultiKey;
  label: string;
  options: CharacterFilterOption[];
  selected: string[];
}

export type CharacterFilterSelectKey =
  | 'mediaType'
  | 'originType'
  | 'reference'
  | 'appearance'
  | 'interpretation'
  | 'source'
  | 'unclassified'
  | 'birthdayStatus'
  | 'birthdayMonth'
  | 'tagMode'
  | 'sort';

export interface CharacterFilterSelectControl {
  key: CharacterFilterSelectKey;
  label: string;
  value: string;
  options: CharacterFilterOption[];
}

export interface CharacterFilterSelectSection {
  id: string;
  title: string;
  selects: CharacterFilterSelectControl[];
}

export interface CharacterFilterControlModel {
  multi: CharacterFilterMultiControl[];
  sections: CharacterFilterSelectSection[];
  favorite: boolean;
}

const MEDIA_TYPES = ['游戏', '动画', '漫画', '小说', '影视', '其他'] as const;

function options(values: readonly string[]): CharacterFilterOption[] {
  return values.map((value) => ({ value, label: value }));
}

function selectedWithFacetOptions(
  selected: string[],
  facetValues: string[],
): CharacterFilterOption[] {
  return [...new Set([...facetValues, ...selected])].map((value) => ({ value, label: value }));
}

function selectValue(filter: CharacterBrowseQuery, key: CharacterFilterSelectKey): string {
  const value = filter[key];
  return value === undefined || value === null ? '' : String(value);
}

/**
 * One ordered control model for the desktop dialog and the narrow-screen sheet.
 * Keeping this free of React and route state lets the arrangement and option
 * fallbacks be verified without a browser.
 */
export function buildCharacterFilterControls(
  filter: CharacterBrowseQuery,
  facets?: CharacterBrowseResult['facets'],
): CharacterFilterControlModel {
  const works = new Map<string, CharacterFilterOption>();
  for (const work of facets?.works || []) {
    works.set(work.name, { value: work.name, label: work.name, search: work.aliases.join(' ') });
  }
  for (const work of filter.works || []) {
    if (!works.has(work)) works.set(work, { value: work, label: work });
  }

  const makeSelect = (
    key: CharacterFilterSelectKey,
    label: string,
    values: CharacterFilterOption[],
  ): CharacterFilterSelectControl => ({ key, label, value: selectValue(filter, key), options: values });

  return {
    multi: [
      {
        key: 'works',
        label: '作品',
        options: [...works.values()],
        selected: filter.works || [],
      },
      {
        key: 'tags',
        label: '标签',
        options: selectedWithFacetOptions(filter.tags || [], facets?.tags || []),
        selected: filter.tags || [],
      },
      {
        key: 'groups',
        label: '分组',
        options: selectedWithFacetOptions(filter.groups || [], facets?.groups || []),
        selected: filter.groups || [],
      },
    ],
    sections: [
      {
        id: 'classification',
        title: '资料条件',
        selects: [
          makeSelect('mediaType', '作品类型', options(MEDIA_TYPES)),
          makeSelect('originType', '创作类型', [
            { value: 'ip', label: '原作 IP' },
            { value: 'derivative', label: '同人衍生' },
            { value: 'original', label: '原创' },
          ]),
          makeSelect('reference', '外观参考图', [
            { value: 'yes', label: '有可用参考图' },
            { value: 'no', label: '无可用参考图' },
          ]),
          makeSelect('appearance', '外观描述', [
            { value: 'yes', label: '已填写' },
            { value: 'no', label: '未填写' },
          ]),
          makeSelect('interpretation', '人设演绎', selectedWithFacetOptions(
            filter.interpretation ? [filter.interpretation] : [],
            facets?.interpretations || [],
          )),
          makeSelect('source', '导入来源', selectedWithFacetOptions(
            filter.source ? [filter.source] : [],
            facets?.sources || [],
          ).map((option) => ({
            ...option,
            label: option.value === 'local' ? '本地角色卡' : option.value === 'manual' ? '手动创建' : option.label,
          }))),
          makeSelect('unclassified', '待整理', [
            { value: 'work', label: '未设置作品' },
            { value: 'tags', label: '未设置标签' },
          ]),
          makeSelect('tagMode', '标签匹配', [
            { value: 'any', label: '任一标签' },
            { value: 'all', label: '全部标签' },
          ]),
        ],
      },
      {
        id: 'birthday-sort',
        title: '生日与排序',
        selects: [
          makeSelect('birthdayStatus', '生日状态', [
            { value: 'known', label: '生日已知' },
            { value: 'needs_confirmation', label: '生日待确认' },
            { value: 'unset', label: '未填写生日' },
          ]),
          makeSelect('birthdayMonth', '生日月份', (facets?.birthdayMonths || []).map((month) => ({
            value: String(month),
            label: `${month} 月`,
          }))),
          makeSelect('sort', '排序', [
            { value: 'updated', label: '最近更新' },
            { value: 'name', label: '角色名称' },
          ]),
        ],
      },
    ],
    favorite: filter.favorite === true,
  };
}

/** Translate a native select value into the existing browse-query patch shape. */
export function characterFilterSelectPatch(
  key: CharacterFilterSelectKey,
  value: string,
): CharacterBrowseQuery {
  if (!value) return { [key]: undefined };
  if (key === 'birthdayMonth') {
    const month = Number(value);
    return Number.isSafeInteger(month) && month >= 1 && month <= 12
      ? { birthdayMonth: month }
      : { birthdayMonth: undefined };
  }
  return { [key]: value } as CharacterBrowseQuery;
}
