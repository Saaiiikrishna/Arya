'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export default function EligibilityPage() {
  const [criteria, setCriteria] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ questionId: '', operator: 'EQ', value: '', weight: '1' });

  const loadData = async () => {
    const [c, q] = await Promise.all([api.getEligibilityCriteria(), api.getQuestions()]);
    setCriteria(c);
    setQuestions(q);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let parsedValue: any = form.value;
    try { parsedValue = JSON.parse(form.value); } catch { /* keep as string */ }
    await api.createCriteria({
      questionId: form.questionId,
      operator: form.operator,
      value: parsedValue,
      weight: parseFloat(form.weight),
    });
    setShowModal(false);
    setForm({ questionId: '', operator: 'EQ', value: '', weight: '1' });
    loadData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this criterion?')) return;
    await api.deleteCriteria(id);
    loadData();
  };

  const operators = ['EQ', 'NEQ', 'GT', 'LT', 'GTE', 'LTE', 'IN', 'NOT_IN', 'CONTAINS', 'NOT_CONTAINS'];

  if (loading) return <div className="loading-page"><div className="spinner" /> Loading...</div>;

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Eligibility Criteria</h1>
          <p className="page-subtitle">Define screening rules for applicant evaluation</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Criterion</button>
      </div>

      {criteria.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">✅</div>
          <p>No criteria defined. All applicants will be marked eligible by default.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Operator</th>
                <th>Expected Value</th>
                <th>Weight</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {criteria.map((c) => (
                <tr key={c.id}>
                  <td>{c.question?.label || 'Unknown'}</td>
                  <td><span className="badge badge-processing">{c.operator}</span></td>
                  <td className="font-mono text-sm">{JSON.stringify(c.value)}</td>
                  <td>{c.weight}</td>
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c.id)}>Remove</button>
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
            <h2 className="modal-title">Add Eligibility Criterion</h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="form-label">Question *</label>
                <select className="form-input form-select" value={form.questionId} onChange={(e) => setForm({ ...form, questionId: e.target.value })} required>
                  <option value="">Select question...</option>
                  {questions.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
                </select>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Operator *</label>
                  <select className="form-input form-select" value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })}>
                    {operators.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Weight</label>
                  <input type="number" step="0.1" className="form-input" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Value *</label>
                <input className="form-input" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder='e.g., "yes", 18, ["A","B"]' required />
                <span className="text-xs text-muted">For arrays use JSON format: [&quot;value1&quot;, &quot;value2&quot;]</span>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add Criterion</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
