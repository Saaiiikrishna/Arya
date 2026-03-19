'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

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
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Questions</h1>
          <p className="page-subtitle">Configure the questionnaire for applicants</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setForm({ label: '', helpText: '', type: 'TEXT', isRequired: true, category: '', phaseTag: 'INITIAL', options: '' }); setShowModal(true); }}>
          + Add Question
        </button>
      </div>

      {questions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">❓</div>
          <p>No questions yet. Add your first question to get started.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Label</th>
                <th>Type</th>
                <th>Phase</th>
                <th>Required</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q, i) => (
                <tr key={q.id}>
                  <td className="text-muted">{i + 1}</td>
                  <td>
                    <div>{q.label}</div>
                    {q.helpText && <div className="text-xs text-muted">{q.helpText}</div>}
                  </td>
                  <td><span className="badge badge-processing">{q.type}</span></td>
                  <td><span className="badge badge-filling">{q.phaseTag}</span></td>
                  <td>{q.isRequired ? '✓' : '—'}</td>
                  <td>
                    <span className={`badge ${q.isActive ? 'badge-active' : 'badge-removed'}`}>
                      {q.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-sm">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(q)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(q.id)}>Deactivate</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{editing ? 'Edit Question' : 'Add Question'}</h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="form-label">Question Label *</label>
                <input className="form-input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Help Text</label>
                <input className="form-input" value={form.helpText} onChange={(e) => setForm({ ...form, helpText: e.target.value })} />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Type *</label>
                  <select className="form-input form-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {QUESTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Phase</label>
                  <select className="form-input form-select" value={form.phaseTag} onChange={(e) => setForm({ ...form, phaseTag: e.target.value })}>
                    <option value="INITIAL">Initial</option>
                    <option value="ADDITIONAL">Additional</option>
                  </select>
                </div>
              </div>
              {['SELECT', 'MULTISELECT'].includes(form.type) && (
                <div className="form-group">
                  <label className="form-label">Options (comma-separated)</label>
                  <input className="form-input" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder="Option 1, Option 2, Option 3" />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Category</label>
                <input className="form-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g., Personal, Skills, Preferences" />
              </div>
              <label className="flex items-center gap-sm">
                <input type="checkbox" checked={form.isRequired} onChange={(e) => setForm({ ...form, isRequired: e.target.checked })} />
                <span className="text-sm">Required</span>
              </label>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
