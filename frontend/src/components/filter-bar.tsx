'use client';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Props = {
  search: string;
  onSearchChange: (v: string) => void;
  allTags: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  typeOptions?: string[];
  selectedType?: string;
  onTypeChange?: (v: string) => void;
  statusOptions?: string[];
  selectedStatus?: string;
  onStatusChange?: (v: string) => void;
  children?: React.ReactNode;
};

function Dropdown({ label, children, active }: { label: string; children: React.ReactNode; active: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium border transition-all duration-150 ${
          active ? 'border-primary/30 bg-primary-dim text-primary' : 'border-stroke text-dark-5 hover:border-dark-6 hover:text-dark'
        }`}
      >
        {label}
        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.15 }}
          className="w-3 h-3 opacity-50"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </motion.svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full left-0 mt-1.5 bg-surface rounded-xl shadow-card-2 border border-stroke z-50 min-w-[160px] py-1.5 origin-top-left"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CheckItem({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs hover:bg-surface-2 transition-colors text-left"
    >
      <span className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-150 ${
        checked ? 'bg-primary border-primary' : 'border-stroke'
      }`}>
        {checked && (
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
      </span>
      <span className={checked ? 'text-dark font-medium' : 'text-dark-5'}>{label}</span>
    </button>
  );
}

export function FilterBar({
  search, onSearchChange,
  allTags, selectedTags, onTagsChange,
  typeOptions, selectedType, onTypeChange,
  statusOptions, selectedStatus, onStatusChange,
  children,
}: Props) {
  const hasFilters = search || selectedTags.length > 0 || (selectedType && selectedType !== '') || (selectedStatus && selectedStatus !== '');

  const toggleTag = (tag: string) => {
    onTagsChange(
      selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...selectedTags, tag],
    );
  };

  return (
    <div className="flex items-center gap-2 mb-6 flex-wrap">
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search..."
          className="w-full border border-stroke rounded-lg pl-9 pr-3 py-2 text-[13px] outline-none transition-all duration-150 focus:border-primary bg-surface"
        />
      </div>

      {allTags.length > 0 && (
        <Dropdown label={selectedTags.length > 0 ? `Tags (${selectedTags.length})` : 'Tags'} active={selectedTags.length > 0}>
          {allTags.map((tag) => (
            <CheckItem key={tag} checked={selectedTags.includes(tag)} label={tag} onClick={() => toggleTag(tag)} />
          ))}
        </Dropdown>
      )}

      {typeOptions && typeOptions.length > 0 && onTypeChange && (
        <Dropdown label={selectedType ? selectedType : 'Type'} active={!!selectedType}>
          <button
            onClick={() => onTypeChange('')}
            className={`w-full text-left px-3.5 py-2 text-xs hover:bg-surface-2 transition-colors ${!selectedType ? 'font-medium text-primary' : 'text-dark-5'}`}
          >
            All
          </button>
          {typeOptions.map((t) => (
            <button
              key={t}
              onClick={() => onTypeChange(t)}
              className={`w-full text-left px-3.5 py-2 text-xs hover:bg-surface-2 transition-colors ${selectedType === t ? 'font-medium text-primary' : 'text-dark-5'}`}
            >
              {t}
            </button>
          ))}
        </Dropdown>
      )}

      {statusOptions && statusOptions.length > 0 && onStatusChange && (
        <Dropdown label={selectedStatus ? selectedStatus : 'Status'} active={!!selectedStatus}>
          <button
            onClick={() => onStatusChange('')}
            className={`w-full text-left px-3.5 py-2 text-xs hover:bg-surface-2 transition-colors ${!selectedStatus ? 'font-medium text-primary' : 'text-dark-5'}`}
          >
            All
          </button>
          {statusOptions.map((s) => (
            <button
              key={s}
              onClick={() => onStatusChange(s)}
              className={`w-full text-left px-3.5 py-2 text-xs hover:bg-surface-2 transition-colors ${selectedStatus === s ? 'font-medium text-primary' : 'text-dark-5'}`}
            >
              {s}
            </button>
          ))}
        </Dropdown>
      )}

      <AnimatePresence>
        {hasFilters && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={() => { onSearchChange(''); onTagsChange([]); onTypeChange?.(''); onStatusChange?.(''); }}
            className="text-xs text-dark-6 hover:text-primary transition-colors px-2 py-1.5"
          >
            Clear all
          </motion.button>
        )}
      </AnimatePresence>

      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}
