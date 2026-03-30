'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

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
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen relative">
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Eligibility Protocol</h1>
        </div>
        <div className="text-left md:text-right">
          <button 
            onClick={() => setShowModal(true)} 
            className="bg-ink hover:bg-terracotta text-white px-8 py-4 text-xs uppercase tracking-widest font-semibold transition-colors shadow-sm"
          >
            + Add Criterion
          </button>
        </div>
      </header>

      {criteria.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 border border-dashed border-ink/20 bg-parchment/50 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h3 className="font-serif text-2xl font-bold mb-2">No Restrictions</h3>
          <p className="text-ink/60 max-w-md">No criteria filtering defined. All inbound applicants will be marked eligible by default unless manually rejected.</p>
        </div>
      ) : (
        <div className="border border-hairline bg-white overflow-x-auto shadow-sm">
          <table className="w-full text-left font-sans">
            <thead className="bg-parchment/80 border-b border-hairline">
              <tr>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Question Target</th>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Logic Operator</th>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Expected Value</th>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Weight</th>
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Actions</th>
              </tr>
            </thead>
            <tbody>
              {criteria.map((c) => (
                <tr key={c.id} className="border-b border-hairline last:border-0 hover:bg-parchment/30 transition-colors">
                  <td className="px-6 py-5 font-serif text-lg">{c.question?.label || 'Unknown Fragment'}</td>
                  <td className="px-6 py-5">
                    <span className="bg-ink text-white px-3 py-1 text-[10px] uppercase tracking-widest font-bold">
                      {c.operator}
                    </span>
                  </td>
                  <td className="px-6 py-5 font-mono text-sm bg-parchment/40 text-terracotta font-semibold">{JSON.stringify(c.value)}</td>
                  <td className="px-6 py-5 font-serif text-xl font-bold">{c.weight}</td>
                  <td className="px-6 py-5">
                    <button 
                      className="text-[11px] uppercase tracking-widest font-bold text-terracotta hover:text-ink transition-colors" 
                      onClick={() => handleDelete(c.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div 
            className="bg-white border-2 border-ink p-8 shadow-[8px_8px_0px_#1C1B19] w-full max-w-xl animate-fade-in" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-8 pb-4 border-b border-hairline">
              <h2 className="font-serif text-3xl font-bold">Add Eligibility Criterion</h2>
              <button 
                className="text-2xl text-ink/40 hover:text-terracotta transition-colors leading-none" 
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Question Pivot *</label>
                <select 
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors appearance-none cursor-pointer" 
                  value={form.questionId} 
                  onChange={(e) => setForm({ ...form, questionId: e.target.value })} 
                  required
                >
                  <option value="">Select question fragment...</option>
                  {questions.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Logic Operator *</label>
                  <select 
                    className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors appearance-none cursor-pointer" 
                    value={form.operator} 
                    onChange={(e) => setForm({ ...form, operator: e.target.value })}
                  >
                    {operators.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Algorithm Weight</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    className="w-full bg-transparent border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors" 
                    value={form.weight} 
                    onChange={(e) => setForm({ ...form, weight: e.target.value })} 
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Expected Value *</label>
                <input 
                  className="w-full bg-transparent border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors font-mono" 
                  value={form.value} 
                  onChange={(e) => setForm({ ...form, value: e.target.value })} 
                  placeholder='e.g., "yes", 18, ["A","B"]' 
                  required 
                />
                <span className="text-[10px] uppercase tracking-widest text-ink/40 mt-2 block">For arrays use strict JSON format: ["value1", "value2"]</span>
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
                  Inject Criterion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
