'use client';

import type { CharacterBrowseResult } from '@sthstart/contracts';
import { Pagination } from '@/app/components/ui/pagination';
import { CHARACTER_PAGE_SIZE_OPTIONS } from '../filter-url';

export function CharacterPagination({ data, onPage, onPageSizeChange, loading = false }: {
  data?: CharacterBrowseResult;
  onPage: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  loading?: boolean;
}) {
  if (!data) return null;
  return (
    <Pagination
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      onPageChange={onPage}
      onPageSizeChange={onPageSizeChange}
      pageSizeOptions={CHARACTER_PAGE_SIZE_OPTIONS}
      loading={loading}
    />
  );
}
