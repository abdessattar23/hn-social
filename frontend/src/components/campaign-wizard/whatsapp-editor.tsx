'use client';
import { useState, useRef } from 'react';

interface WhatsAppEditorProps {
  content: string;
  onChange: (content: string) => void;
}

const EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊',
  '😇','😍','🤩','😘','😗','😋','😛','🤔','🤗','🤫',
  '😎','🥳','😏','😢','😭','😤','🔥','💯','❤️','👍',
  '👎','👋','🙏','💪','🎉','🎯','✅','⭐','📢','📩',
];

export default function WhatsAppEditor({ content, onChange }: WhatsAppEditorProps) {
  const [showEmojis, setShowEmojis] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = content.slice(0, start) + emoji + content.slice(end);
    onChange(next);
    // Restore cursor position after emoji
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + emoji.length;
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-dark mb-1.5">Message</label>
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            rows={10}
            placeholder="Type your WhatsApp message..."
            className="w-full border border-stroke rounded-lg px-5 py-3 text-sm outline-none transition focus:border-primary resize-y bg-surface-2"
          />
          <button
            type="button"
            onClick={() => setShowEmojis(!showEmojis)}
            className="absolute top-3 right-3 text-xl hover:scale-110 transition-transform"
            title="Insert emoji"
          >
            😊
          </button>
          {showEmojis && (
            <div className="absolute top-12 right-3 bg-surface border border-stroke rounded-lg shadow-card-2 p-3 z-10 w-[280px]">
              <div className="grid grid-cols-8 gap-1">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => insertEmoji(e)}
                    className="text-xl hover:bg-surface-2 rounded-lg p-1 transition-colors"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
