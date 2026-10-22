import type { Request } from 'express';

export interface Pagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export function getPagination(
  req: Request,
  options: { allowedSort: string[]; defaultSort: string },
): Pagination {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(String(req.query.pageSize ?? '20'), 10) || 20),
  );
  const requested = String(req.query.sortBy ?? options.defaultSort);
  const sortBy = options.allowedSort.includes(requested) ? requested : options.defaultSort;
  const sortDir = String(req.query.sortDir ?? 'desc') === 'asc' ? 'asc' : 'desc';
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sortBy, sortDir };
}

export function paginated<T>(data: T[], total: number, pagination: Pagination) {
  return {
    data,
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
    },
  };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join(
    '\n',
  );
}
