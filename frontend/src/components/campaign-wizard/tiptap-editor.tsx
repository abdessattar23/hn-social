'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import { useState, useCallback } from 'react';

interface TipTapEditorProps {
  content: string;
  onChange: (html: string) => void;
  subject: string;
  onSubjectChange: (subject: string) => void;
}

export default function TipTapEditor({ content, onChange, subject, onSubjectChange }: TipTapEditorProps) {
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceHtml, setSourceHtml] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image,
      Underline,
    ],
    content,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  const toggleSource = useCallback(() => {
    if (!editor) return;
    if (sourceMode) {
      // Switching back to WYSIWYG — apply source HTML
      editor.commands.setContent(sourceHtml);
      onChange(sourceHtml);
    } else {
      // Switching to source — capture current HTML
      setSourceHtml(editor.getHTML());
    }
    setSourceMode(!sourceMode);
  }, [editor, sourceMode, sourceHtml, onChange]);

  const handleSourceChange = (html: string) => {
    setSourceHtml(html);
    onChange(html);
  };

  const addLink = useCallback(() => {
    if (!editor) return;
    const url = prompt('Enter URL:');
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  const ToolbarBtn = ({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title: string }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg text-[13px] font-medium transition-colors ${
        active ? 'bg-primary/10 text-primary' : 'text-dark-5 hover:bg-surface-2 hover:text-dark'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-dark mb-1.5">Subject</label>
        <input
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          placeholder="Email subject line"
          className="w-full border border-stroke rounded-lg px-5 py-3 text-sm outline-none transition focus:border-primary"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-dark mb-1.5">Body</label>
        <div className="tiptap-editor border border-stroke rounded-xl overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-stroke bg-surface-2 flex-wrap">
            <ToolbarBtn
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="Bold"
            >
              <strong>B</strong>
            </ToolbarBtn>
            <ToolbarBtn
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="Italic"
            >
              <em>I</em>
            </ToolbarBtn>
            <ToolbarBtn
              active={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              title="Underline"
            >
              <span className="underline">U</span>
            </ToolbarBtn>

            <div className="w-px h-5 bg-stroke mx-1" />

            <ToolbarBtn
              active={editor.isActive('link')}
              onClick={addLink}
              title="Link"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
            </ToolbarBtn>

            <div className="w-px h-5 bg-stroke mx-1" />

            <ToolbarBtn
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title="Bullet List"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
              </svg>
            </ToolbarBtn>
            <ToolbarBtn
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              title="Ordered List"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.242 5.992h12m-12 6.003h12m-12 5.999h12M4.117 7.495v-3.75H2.99m1.125 3.75H2.99m1.125 0H5.24m-1.92 2.577a1.125 1.125 0 1 1 1.591 1.59l-1.83 1.83h2.16" />
              </svg>
            </ToolbarBtn>

            <div className="w-px h-5 bg-stroke mx-1" />

            <ToolbarBtn
              active={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              title="Heading"
            >
              H
            </ToolbarBtn>

            <div className="ml-auto" />

            <ToolbarBtn
              active={sourceMode}
              onClick={toggleSource}
              title="Source HTML"
            >
              {'</>'}
            </ToolbarBtn>
          </div>

          {/* Editor / Source */}
          {sourceMode ? (
            <textarea
              value={sourceHtml}
              onChange={(e) => handleSourceChange(e.target.value)}
              className="w-full min-h-[300px] p-4 text-sm font-mono outline-none resize-y"
              spellCheck={false}
            />
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>
      </div>
    </div>
  );
}
