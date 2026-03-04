'use client';
import { useState, useRef, useEffect } from 'react';

const TAG_COLORS = [
  'bg-primary-dim text-primary',
  'bg-green-light-7 text-green',
  'bg-yellow-light-4 text-yellow-dark',
  'bg-red-light-6 text-red',
  'bg-blue-light-5 text-blue',
  'bg-surface-2 text-dark-5',
];

function tagColor(tag: string) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

type Props = {
  tags: string[];
  editable?: boolean;
  allTags?: string[];
  onAdd?: (tag: string) => void;
  onRemove?: (tag: string) => void;
};

export function TagPills({ tags, editable, allTags = [], onAdd, onRemove }: Props) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const suggestions = allTags
    .filter((t) => !tags.includes(t))
    .filter((t) => !input || t.toLowerCase().includes(input.toLowerCase()));

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onAdd?.(trimmed);
    setInput('');
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (input.trim()) addTag(input);
    }
  };

  if (!editable) {
    if (!tags || tags.length === 0) return <span className="text-dark-6 text-xs">--</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <span key={t} className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${tagColor(t)}`}>{t}</span>
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap gap-1.5 items-center">
        {tags.map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${tagColor(t)}`}>
            {t}
            <button onClick={() => onRemove?.(t)} className="hover:opacity-70 transition-opacity ml-0.5">
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? 'Add tags...' : '+'}
          className="border-none outline-none bg-transparent text-xs min-w-[60px] w-20 py-0.5 placeholder:text-dark-6"
        />
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 mt-1.5 bg-surface rounded-xl shadow-card-2 border border-stroke z-50 max-h-40 overflow-y-auto min-w-[160px] py-1">
          {suggestions.map((t) => (
            <button
              key={t}
              onClick={() => addTag(t)}
              className="w-full text-left px-3.5 py-2 text-xs hover:bg-surface-2 transition-colors"
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
