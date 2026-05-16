'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

type Clip = {
  id: string;
  week: number;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  isPublished: boolean;
  publishedAt?: string;
  createdAt: string;
};

const EMPTY_UPLOAD = { title: '', week: 1, description: '', fileName: '', mimeType: 'video/mp4' };

export default function AdminDocumentaryPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [clipsLoading, setClipsLoading] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState(EMPTY_UPLOAD);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'url' | 's3' | 'confirm' | 'done'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);

  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    api.getBatches()
      .then((bs) => {
        setBatches(bs);
        if (bs[0]?.id) {
          setSelectedBatch(bs[0].id);
          return api.getTeamsByBatch(bs[0].id);
        }
        return [];
      })
      .then((ts) => setTeams(ts))
      .finally(() => setLoading(false));
  }, []);

  async function handleBatchChange(batchId: string) {
    setSelectedBatch(batchId);
    setSelectedTeamId('');
    setClips([]);
    const ts = await api.getTeamsByBatch(batchId);
    setTeams(ts);
  }

  async function handleTeamChange(teamId: string) {
    setSelectedTeamId(teamId);
    setClips([]);
    if (!teamId) return;
    setClipsLoading(true);
    try {
      const cs = await api.listDocumentaryClips(teamId);
      setClips(cs);
    } finally {
      setClipsLoading(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile || !selectedTeamId) return;
    setUploading(true);
    setUploadProgress('url');
    try {
      // 1. Get presigned URL
      const { uploadUrl, clipId } = await api.getDocumentaryUploadUrl(selectedTeamId, {
        fileName: selectedFile.name,
        mimeType: selectedFile.type || 'video/mp4',
        week: uploadForm.week,
        title: uploadForm.title,
        description: uploadForm.description || undefined,
      });

      // 2. PUT file to S3
      setUploadProgress('s3');
      await fetch(uploadUrl, {
        method: 'PUT',
        body: selectedFile,
        headers: { 'Content-Type': selectedFile.type || 'video/mp4' },
      });

      // 3. Confirm upload
      setUploadProgress('confirm');
      await api.confirmDocumentaryUpload(clipId);

      setUploadProgress('done');
      setShowUpload(false);
      setUploadForm(EMPTY_UPLOAD);
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';

      // Reload clips
      const cs = await api.listDocumentaryClips(selectedTeamId);
      setClips(cs);
    } catch (err: any) {
      alert(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress('idle');
    }
  }

  async function handleTogglePublish(clip: Clip) {
    setToggling(clip.id);
    try {
      await api.publishDocumentaryClip(clip.id, !clip.isPublished);
      setClips((prev) => prev.map((c) => c.id === clip.id ? { ...c, isPublished: !c.isPublished } : c));
    } catch (err: any) {
      alert(err.message);
    } finally {
      setToggling(null);
    }
  }

  async function handleDelete(clipId: string) {
    if (!confirm('Delete this clip? This cannot be undone.')) return;
    setDeleting(clipId);
    try {
      await api.deleteDocumentaryClip(clipId);
      setClips((prev) => prev.filter((c) => c.id !== clipId));
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleOpenStream(clipId: string) {
    try {
      const { url } = await api.getDocumentaryStreamUrl(clipId);
      window.open(url, '_blank', 'noopener');
    } catch (err: any) {
      alert(err.message);
    }
  }

  const UPLOAD_STEP_LABELS = { url: 'Preparing upload…', s3: 'Uploading to S3…', confirm: 'Confirming…', done: 'Done!' };

  if (loading) return (
    <div className="flex-center min-h-[60vh]">
      <div className="spinner mb-4"></div>
      <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading</p>
    </div>
  );

  const publishedCount = clips.filter((c) => c.isPublished).length;

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      <header className="border-b border-hairline pb-8 mb-10 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Documentary</h1>
          <p className="text-sm text-ink/50 mt-2">Cinematic journey clips — upload, review and publish for investor reel</p>
        </div>
        {selectedTeamId && (
          <button onClick={() => setShowUpload(true)} className="btn btn-primary px-8">
            + Upload Clip
          </button>
        )}
      </header>

      {/* Selectors */}
      <div className="flex flex-wrap gap-4 mb-10">
        <div className="flex items-center gap-3">
          <label className="text-[11px] uppercase tracking-widest font-bold text-ink/50">Batch</label>
          <select value={selectedBatch} onChange={(e) => handleBatchChange(e.target.value)}
            className="border border-hairline bg-white text-sm px-3 py-2 text-ink outline-none">
            {batches.map((b: any) => (
              <option key={b.id} value={b.id}>Batch {b.batchNumber} — {b.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-[11px] uppercase tracking-widest font-bold text-ink/50">Team</label>
          <select value={selectedTeamId} onChange={(e) => handleTeamChange(e.target.value)}
            className="border border-hairline bg-white text-sm px-3 py-2 text-ink outline-none min-w-[220px]">
            <option value="">— Select a team —</option>
            {teams.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        {selectedTeamId && clips.length > 0 && (
          <div className="ml-auto flex items-center gap-3 text-[11px] uppercase tracking-widest font-bold text-ink/50">
            <span>{clips.length} clips</span>
            <span className="text-forest">{publishedCount} published</span>
          </div>
        )}
      </div>

      {/* Empty states */}
      {!selectedTeamId && (
        <div className="text-center py-24 border border-hairline bg-parchment/30">
          <p className="text-ink/50 uppercase tracking-widest text-xs font-semibold">Select a team to manage their documentary clips</p>
        </div>
      )}

      {selectedTeamId && clipsLoading && (
        <div className="text-center py-16 text-ink/50 text-sm uppercase tracking-widest">Loading clips…</div>
      )}

      {selectedTeamId && !clipsLoading && clips.length === 0 && (
        <div className="text-center py-20 border border-hairline bg-parchment/30">
          <p className="text-ink/60 mb-4">No clips uploaded yet for this team.</p>
          <button onClick={() => setShowUpload(true)} className="btn btn-primary">Upload First Clip</button>
        </div>
      )}

      {/* Clips grid */}
      {selectedTeamId && !clipsLoading && clips.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {clips.map((clip) => (
            <div key={clip.id} className={`border flex flex-col ${clip.isPublished ? 'border-forest/30 bg-forest/5' : 'border-hairline bg-white'}`}>
              {/* Thumbnail / placeholder */}
              <div className="aspect-video bg-ink/5 border-b border-hairline flex items-center justify-center relative">
                {clip.thumbnailUrl ? (
                  <img src={clip.thumbnailUrl} alt={clip.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-ink/30">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.845v6.31a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span className="text-[10px] uppercase tracking-widest font-bold">Video</span>
                  </div>
                )}
                {clip.isPublished && (
                  <span className="absolute top-2 right-2 bg-forest text-white text-[9px] uppercase tracking-widest font-bold px-2 py-0.5">
                    Published
                  </span>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-bold text-sm leading-snug">{clip.title}</p>
                  <span className="shrink-0 text-[10px] uppercase tracking-widest font-bold border border-ink/20 text-ink/50 px-2 py-0.5">
                    Week {clip.week}
                  </span>
                </div>
                {clip.description && <p className="text-xs text-ink/50 mb-3 line-clamp-2">{clip.description}</p>}
                <p className="text-[10px] text-ink/30 uppercase tracking-widest mt-auto mb-3">
                  {new Date(clip.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenStream(clip.id)}
                    className="text-[10px] uppercase tracking-widest font-bold border border-ink/20 text-ink/60 px-3 py-1.5 hover:border-ink hover:text-ink transition-colors flex-1"
                  >
                    Play
                  </button>
                  <button
                    onClick={() => handleTogglePublish(clip)}
                    disabled={toggling === clip.id}
                    className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1.5 transition-colors flex-1 ${
                      clip.isPublished
                        ? 'border border-terracotta/40 text-terracotta hover:bg-terracotta hover:text-white'
                        : 'border border-forest text-forest hover:bg-forest hover:text-white'
                    }`}
                  >
                    {toggling === clip.id ? '…' : clip.isPublished ? 'Unpublish' : 'Publish'}
                  </button>
                  <button
                    onClick={() => handleDelete(clip.id)}
                    disabled={deleting === clip.id}
                    className="text-[10px] uppercase tracking-widest font-bold border border-terracotta/30 text-terracotta/60 px-3 py-1.5 hover:bg-terracotta hover:text-white transition-colors"
                  >
                    {deleting === clip.id ? '…' : '×'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
          <div className="bg-parchment border border-ink/20 w-full max-w-lg p-8">
            <h2 className="font-serif text-2xl font-bold mb-6">Upload Documentary Clip</h2>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Week Number</label>
                <input
                  required type="number" min={1} max={13}
                  value={uploadForm.week}
                  onChange={(e) => setUploadForm((f) => ({ ...f, week: Number(e.target.value) }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Title</label>
                <input
                  required value={uploadForm.title}
                  onChange={(e) => setUploadForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Week 3 — The Pivot"
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Description (optional)</label>
                <textarea
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Video File</label>
                <input
                  ref={fileRef}
                  type="file"
                  required
                  accept="video/*"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  className="w-full border border-hairline px-3 py-2 text-sm text-ink/60 outline-none file:mr-3 file:border-0 file:bg-forest file:text-white file:text-[10px] file:uppercase file:tracking-widest file:px-3 file:py-1"
                />
                {selectedFile && (
                  <p className="text-[10px] text-ink/40 mt-1">{selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)</p>
                )}
              </div>

              {uploading && (
                <div className="border border-forest/30 bg-forest/5 px-4 py-3 text-[11px] uppercase tracking-widest font-bold text-forest">
                  {UPLOAD_STEP_LABELS[uploadProgress as keyof typeof UPLOAD_STEP_LABELS] ?? 'Uploading…'}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowUpload(false); setSelectedFile(null); }} className="btn btn-secondary flex-1" disabled={uploading}>
                  Cancel
                </button>
                <button type="submit" disabled={uploading || !selectedFile} className="btn btn-primary flex-1">
                  {uploading ? 'Uploading…' : 'Upload Clip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
