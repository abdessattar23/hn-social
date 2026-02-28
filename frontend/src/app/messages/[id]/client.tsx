'use client';
import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { TagPills } from '@/components/tag-pills';
import { RichTextEditor } from '@/components/rich-text-editor';
import { AnimatedPage } from '@/components/motion';

type Attachment = { filename: string; originalName: string; mimeType: string };
type Message = { id: number; name: string; type: string; subject: string; body: string; tags: string[]; attachments: Attachment[] };

export default function MessageDetailPage() {
  const { id } = useParams();
  const { authed } = useRequireAuth();
  const [msg, setMsg] = useState<Message | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!authed) return;
    load();
    api.get('/messages').then((msgs: Message[]) => {
      const set = new Set<string>();
      msgs.forEach((m) => (m.tags || []).forEach((t) => set.add(t)));
      setAllTags([...set].sort());
    }).catch(() => {});
  }, [authed, id]);

  const load = () =>
    api.get(`/messages/${id}`).then((m) => {
      setMsg(m); setName(m.name); setSubject(m.subject || ''); setBody(m.body);
    }).catch(() => {});

  const save = async () => {
    setSaving(true);
    await api.put(`/messages/${id}`, { name, subject, body });
    setSaving(false);
  };

  // Auto-save with debounce
  const debounceSave = (newName: string, newSubject: string, newBody: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await api.put(`/messages/${id}`, { name: newName, subject: newSubject, body: newBody });
      setSaving(false);
    }, 800);
  };

  const handleNameChange = (v: string) => { setName(v); debounceSave(v, subject, body); };
  const handleSubjectChange = (v: string) => { setSubject(v); debounceSave(name, v, body); };
  const handleBodyChange = (v: string) => { setBody(v); debounceSave(name, subject, v); };

  const updateTags = async (tags: string[]) => {
    await api.patch(`/messages/${id}/tags`, { tags });
    setMsg((prev) => prev ? { ...prev, tags } : prev);
    setAllTags((prev) => {
      const set = new Set(prev);
      tags.forEach((t) => set.add(t));
      return [...set].sort();
    });
  };

  const uploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    await api.upload(`/messages/${id}/attachments`, form);
    load();
    e.target.value = '';
  };

  const removeAttachment = async (filename: string) => {
    await api.del(`/messages/${id}/attachments/${filename}`);
    load();
  };

  if (!authed || !msg) return <div className="text-dark-5 text-sm p-4">Loading...</div>;

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-3">
        <a href="/messages" className="text-sm text-dark-5 hover:text-dark flex items-center gap-1 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
          Back to Templates
        </a>
        <div className="flex items-center gap-2 text-xs text-dark-6">
          {saving && <span>Saving...</span>}
          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${msg.type === 'EMAIL' ? 'bg-blue-light-5 text-blue' : msg.type === 'WHATSAPP' ? 'bg-green-light-7 text-green' : 'bg-linkedin-light text-linkedin'}`}>{msg.type}</span>
        </div>
      </div>

      <input
        value={name}
        onChange={(e) => handleNameChange(e.target.value)}
        className="w-full text-xl font-bold text-dark bg-transparent outline-none border-b border-transparent hover:border-stroke focus:border-primary pb-1 mb-1 transition"
        placeholder="Template name"
      />

      <div className="mb-3">
        <TagPills
          tags={msg.tags || []}
          editable
          allTags={allTags}
          onAdd={(tag) => updateTags([...(msg.tags || []), tag])}
          onRemove={(tag) => updateTags((msg.tags || []).filter((t) => t !== tag))}
        />
      </div>

      {msg.type === 'EMAIL' && (
        <input
          placeholder="Subject"
          value={subject}
          onChange={(e) => handleSubjectChange(e.target.value)}
          className="w-full text-sm text-dark-5 bg-transparent outline-none border-b border-transparent hover:border-stroke focus:border-primary pb-1 mb-3 transition"
        />
      )}

      {msg.type === 'EMAIL' ? (
        <RichTextEditor content={body} onChange={handleBodyChange} minHeight="250px" />
      ) : msg.type === 'LINKEDIN' ? (
        <textarea
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          rows={10}
          className="w-full rounded-lg border border-stroke px-4 py-3 text-sm outline-none transition focus:border-primary resize-y bg-surface"
          placeholder="LinkedIn message text..."
        />
      ) : (
        <textarea
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          rows={10}
          className="w-full rounded-lg border border-stroke px-4 py-3 text-sm outline-none transition focus:border-primary resize-y bg-surface"
          placeholder="Message text..."
        />
      )}

      <div className="mt-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-medium text-xs text-dark-5 uppercase tracking-wider">Attachments</h3>
          <label className="text-xs text-primary hover:text-primary/80 cursor-pointer transition-colors">
            + Upload
            <input type="file" onChange={uploadAttachment} className="hidden" />
          </label>
        </div>
        {msg.attachments?.length > 0 ? (
          <div className="space-y-1">
            {msg.attachments.map((a) => (
              <div key={a.filename} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-surface border border-stroke/60 shadow-1">
                <span className="flex-1 text-dark truncate">{a.originalName}</span>
                <span className="text-dark-6">{a.mimeType}</span>
                <button onClick={() => removeAttachment(a.filename)} className="text-red hover:text-red/80 font-medium transition-colors">Remove</button>
              </div>
            ))}
          </div>
        ) : <p className="text-dark-6 text-xs">No attachments</p>}
      </div>
    </AnimatedPage>
  );
}
