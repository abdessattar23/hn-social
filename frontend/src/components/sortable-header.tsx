'use client';

export type SortDir = 'asc' | 'desc';
export type SortState = { key: string; dir: SortDir };

interface SortableHeaderProps {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  className?: string;
}

export function SortableHeader({ label, sortKey, sort, onSort, className = '' }: SortableHeaderProps) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`px-5 py-4 font-medium text-[11px] uppercase tracking-wider cursor-pointer select-none hover:text-dark transition-colors ${active ? 'text-dark' : 'text-dark-5'} ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-25'}`}>
          {active ? (
            <svg className={`w-3.5 h-3.5 transition-transform duration-150 ${sort.dir === 'desc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
            </svg>
          )}
        </span>
      </span>
    </th>
  );
}

export function toggleSort(current: SortState, key: string): SortState {
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: 'asc' };
}

export function sortItems<T>(items: T[], sort: SortState, getters: Record<string, (item: T) => string | number>): T[] {
  const getter = getters[sort.key];
  if (!getter) return items;
  return [...items].sort((a, b) => {
    const va = getter(a);
    const vb = getter(b);
    let cmp: number;
    if (typeof va === 'string' && typeof vb === 'string') {
      cmp = va.localeCompare(vb);
    } else {
      cmp = (va as number) - (vb as number);
    }
    return sort.dir === 'desc' ? -cmp : cmp;
  });
}
