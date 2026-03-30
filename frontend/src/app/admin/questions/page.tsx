'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

const QUESTION_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'MULTISELECT', 'BOOLEAN', 'DATE', 'EMAIL', 'PHONE', 'URL'];

export default function QuestionsPage() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({
    label: '', helpText: '', type: 'TEXT', isRequired: true,
    category: '', phaseTag: 'INITIAL', options: '',
  });

  const loadQuestions = () => {
    api.getQuestions(false).then(setQuestions).finally(() => setLoading(false));
  };

  useEffect(() => { loadQuestions(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data: any = {
      label: form.label,
      helpText: form.helpText || undefined,
      type: form.type,
      isRequired: form.isRequired,
      category: form.category || undefined,
      phaseTag: form.phaseTag,
    };
    if (['SELECT', 'MULTISELECT'].includes(form.type) && form.options) {
      data.options = form.options.split(',').map((o: string) => ({
        value: o.trim(), label: o.trim(),
      }));
    }
    try {
      if (editing) {
        await api.updateQuestion(editing.id, data);
      } else {
        await api.createQuestion(data);
      }
      setShowModal(false);
      setEditing(null);
      setForm({ label: '', helpText: '', type: 'TEXT', isRequired: true, category: '', phaseTag: 'INITIAL', options: '' });
      loadQuestions();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const openEdit = (q: any) => {
    setEditing(q);
    setForm({
      label: q.label, helpText: q.helpText || '', type: q.type,
      isRequired: q.isRequired, category: q.category || '',
      phaseTag: q.phaseTag,
      options: q.options ? q.options.map((o: any) => o.value).join(', ') : '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this question?')) return;
    await api.deleteQuestion(id);
    loadQuestions();
  };

  if (loading) return <div className="loading-page"><div className="spinner" /> Loading...</div>;

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen relative">
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Questionnaire Blueprint</h1>
        </div>
        <div className="text-left md:text-right">
          <button 
            onClick={() => { setEditing(null); setForm({ label: '', helpText: '', type: 'TEXT', isRequired: true, category: '', phaseTag: 'INITIAL', options: '' }); setShowModal(true); }}
            className="bg-ink hover:bg-terracotta text-white px-8 py-4 text-xs uppercase tracking-widest font-semibold transition-colors shadow-sm"
          >
            + Add Question
          </button>
        </div>
      </header>

      {questions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 border border-dashed border-ink/20 bg-parchment/50 text-center">
          <div className="text-4xl mb-4">❓</div>
          <h3 className="font-serif text-2xl font-bold mb-2">No Application Triggers</h3>
          <p className="text-ink/60">No questions mapped yet. Applicants will pass the dossier immediately.</p>
        </div>
      ) : (
        <div className="border border-hairline bg-white overflow-x-auto shadow-sm">
          <table className="w-full text-left font-sans">
            <thead className="bg-parchment/80 border-b border-hairline">
              <tr>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60 w-16">No.</th>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Label Fragment</th>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Input Type</th>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Application Phase</th>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60 text-center">Req.</th>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60 text-center">Status</th>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q, i) => (
                <tr key={q.id} className="border-b border-hairline last:border-0 hover:bg-parchment/30 transition-colors">
                  <td className="px-6 py-5 font-serif text-xl font-bold text-ink/40">{i + 1}</td>
                  <td className="px-6 py-5">
                    <div className="font-serif text-xl font-bold">{q.label}</div>
                    {q.helpText && <div className="text-[11px] uppercase tracking-widest text-ink/40 mt-1">{q.helpText}</div>}
                  </td>
                  <td className="px-6 py-5">
                    <span className="bg-ink text-white px-3 py-1 text-[10px] uppercase tracking-widest font-bold">
                      {q.type}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <span className="bg-forest/10 text-forest border border-forest/20 px-3 py-1 text-[10px] uppercase tracking-widest font-bold">
                      {q.phaseTag}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-center font-serif text-xl text-ink/40">{q.isRequired ? '✓' : '—'}</td>
                  <td className="px-6 py-5 text-center">
                    <span className={`px-2 py-1 text-[10px] uppercase tracking-widest font-bold border ${q.isActive ? 'border-forest text-forest bg-forest/5' : 'border-terracotta text-terracotta bg-terracotta/5'}`}>
                      {q.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex gap-4 justify-end">
                      <button className="text-[11px] uppercase tracking-widest font-bold text-forest hover:text-ink transition-colors" onClick={() => openEdit(q)}>Edit</button>
                      <button className="text-[11px] uppercase tracking-widest font-bold text-terracotta hover:text-ink transition-colors" onClick={() => handleDelete(q.id)}>Deactivate</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm overflow-y-auto" onClick={() => setShowModal(false)}>
          <div 
            className="bg-white border-2 border-ink p-8 shadow-[8px_8px_0px_#1C1B19] w-full max-w-2xl my-8 animate-fade-in relative" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-8 pb-4 border-b border-hairline">
              <h2 className="font-serif text-3xl font-bold">{editing ? 'Modify Blueprint' : 'Inject Protocol Question'}</h2>
              <button 
                className="text-2xl text-ink/40 hover:text-terracotta transition-colors leading-none" 
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Question Label *</label>
                <input 
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-serif text-xl focus:outline-none focus:border-forest transition-colors" 
                  value={form.label} 
                  onChange={(e) => setForm({ ...form, label: e.target.value })} 
                  required 
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Extended Help Context</label>
                <input 
                  className="w-full bg-transparent border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors" 
                  value={form.helpText} 
                  onChange={(e) => setForm({ ...form, helpText: e.target.value })} 
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Input Matrix Type *</label>
                  <select 
                    className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors appearance-none cursor-pointer" 
                    value={form.type} 
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    {QUESTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Assigned Phase</label>
                  <select 
                    className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors appearance-none cursor-pointer" 
                    value={form.phaseTag} 
                    onChange={(e) => setForm({ ...form, phaseTag: e.target.value })}
                  >
                    <option value="INITIAL">Preliminary Phase</option>
                    <option value="ADDITIONAL">Secondary Review</option>
                  </select>
                </div>
              </div>

              {['SELECT', 'MULTISELECT'].includes(form.type) && (
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Enumerated Options</label>
                  <input 
                    className="w-full bg-transparent border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors" 
                    value={form.options} 
                    onChange={(e) => setForm({ ...form, options: e.target.value })} 
                    placeholder="E.g., Protocol A, Protocol B, System Override" 
                  />
                  <span className="text-[10px] uppercase tracking-widest text-ink/40 mt-2 block">Comma separated list</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-6 items-center">
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Classification Bucket</label>
                  <input 
                    className="w-full bg-transparent border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors" 
                    value={form.category} 
                    onChange={(e) => setForm({ ...form, category: e.target.value })} 
                    placeholder="e.g., Demographics, Technical" 
                  />
                </div>
                <div className="pt-6">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={`w-5 h-5 flex items-center justify-center border-2 transition-colors ${form.isRequired ? 'bg-forest border-forest' : 'bg-transparent border-ink/30'}`}>
                       {form.isRequired && <span className="text-white text-xs">✓</span>}
                    </div>
                    <input 
                      type="checkbox" 
                      checked={form.isRequired} 
                      onChange={(e) => setForm({ ...form, isRequired: e.target.checked })} 
                      className="hidden" 
                    />
                    <span className="text-sm font-bold uppercase tracking-widest text-ink group-hover:text-forest transition-colors">Mandatory Submission</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-4 mt-8 pt-6 border-t border-hairline justify-end">
                <button 
                  type="button" 
                  className="px-6 py-3 border border-ink text-xs uppercase tracking-widest font-semibold text-ink hover:bg-parchment transition-colors" 
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="bg-forest hover:opacity-90 text-white px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-colors"
                >
                  {editing ? 'Commit Modifications' : 'Publish Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
