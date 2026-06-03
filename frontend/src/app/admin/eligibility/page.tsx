'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

const EMPTY_FORM = { questionId: '', operator: 'EQ', value: '', weight: '1' };

export default function EligibilityPage() {
  const [criteria, setCriteria] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Evaluate-applicant tool state
  const [showEvaluator, setShowEvaluator] = useState(false);
  const [applicantId, setApplicantId] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<{
    eligible: boolean;
    results: Array<{ criteriaId: string; passed: boolean; reason: string }>;
  } | null>(null);
  const [evalError, setEvalError] = useState('');

  const loadData = async () => {
    const [c, q] = await Promise.all([api.getEligibilityCriteria(), api.getQuestions()]);
    setCriteria(c);
    setQuestions(q);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      questionId: c.questionId ?? c.question?.id ?? '',
      operator: c.operator,
      value: JSON.stringify(c.value),
      weight: String(c.weight ?? '1'),
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm({ ...EMPTY_FORM });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let parsedValue: any = form.value;
    try { parsedValue = JSON.parse(form.value); } catch { /* keep as string */ }
    try {
      if (editing) {
        // The backend update endpoint accepts operator/value/weight (not questionId);
        // the criterion's question target is fixed once created.
        await api.updateCriteria(editing.id, {
          operator: form.operator,
          value: parsedValue,
          weight: parseFloat(form.weight),
        });
      } else {
        await api.createCriteria({
          questionId: form.questionId,
          operator: form.operator,
          value: parsedValue,
          weight: parseFloat(form.weight),
        });
      }
      closeModal();
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this criterion?')) return;
    try {
      await api.deleteCriteria(id);
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleEvaluate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applicantId.trim()) return;
    setEvaluating(true);
    setEvalError('');
    setEvalResult(null);
    try {
      const res = await api.evaluateApplicant(applicantId.trim());
      setEvalResult(res);
    } catch (err: any) {
      setEvalError(err.message || 'Evaluation failed');
    } finally {
      setEvaluating(false);
    }
  };

  const closeEvaluator = () => {
    setShowEvaluator(false);
    setApplicantId('');
    setEvalResult(null);
    setEvalError('');
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
        <div className="flex flex-wrap gap-4 justify-start md:justify-end">
          <button
            onClick={() => { setShowEvaluator(true); setEvalResult(null); setEvalError(''); }}
            className="border border-ink hover:bg-ink hover:text-white text-ink px-8 py-4 text-xs uppercase tracking-widest font-semibold transition-colors"
          >
            Evaluate Applicant
          </button>
          <button
            onClick={openCreate}
            className="bg-saffron hover:bg-saffron-deep text-parchment px-8 py-4 text-xs uppercase tracking-widest font-semibold transition-colors shadow-pop"
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
                <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60 text-right">Actions</th>
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
                  <td className="px-6 py-5 font-mono text-sm bg-parchment/40 text-terracotta-warm font-semibold">{JSON.stringify(c.value)}</td>
                  <td className="px-6 py-5 font-serif text-xl font-bold">{c.weight}</td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex gap-4 justify-end">
                      <button
                        className="text-[11px] uppercase tracking-widest font-bold text-forest hover:text-ink transition-colors"
                        onClick={() => openEdit(c)}
                      >
                        Edit
                      </button>
                      <button
                        className="text-[11px] uppercase tracking-widest font-bold text-terracotta hover:text-ink transition-colors"
                        onClick={() => handleDelete(c.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm" onClick={closeModal}>
          <div
            className="bg-white border-2 border-ink p-8 shadow-[8px_8px_0px_#1C1B19] w-full max-w-xl animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-8 pb-4 border-b border-hairline">
              <h2 className="font-serif text-3xl font-bold">{editing ? 'Modify Criterion' : 'Add Eligibility Criterion'}</h2>
              <button
                className="text-2xl text-ink/40 hover:text-terracotta-warm transition-colors leading-none"
                onClick={closeModal}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Question Pivot *</label>
                <select
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors appearance-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  value={form.questionId}
                  onChange={(e) => setForm({ ...form, questionId: e.target.value })}
                  required
                  disabled={!!editing}
                >
                  <option value="">Select question fragment...</option>
                  {questions.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
                </select>
                {editing && (
                  <span className="text-[10px] uppercase tracking-widest text-ink/40 mt-2 block">Question target is fixed once a criterion is created.</span>
                )}
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
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-saffron hover:bg-saffron-deep text-parchment px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-colors shadow-pop"
                >
                  {editing ? 'Commit Modifications' : 'Inject Criterion'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEvaluator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm overflow-y-auto" onClick={closeEvaluator}>
          <div
            className="bg-white border-2 border-ink p-8 shadow-[8px_8px_0px_#1C1B19] w-full max-w-xl my-8 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-8 pb-4 border-b border-hairline">
              <h2 className="font-serif text-3xl font-bold">Evaluate Applicant</h2>
              <button
                className="text-2xl text-ink/40 hover:text-terracotta-warm transition-colors leading-none"
                onClick={closeEvaluator}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleEvaluate} className="flex flex-col gap-6">
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Applicant ID *</label>
                <input
                  className="w-full bg-transparent border-b border-ink/20 px-4 py-3 font-mono focus:outline-none focus:border-forest transition-colors"
                  value={applicantId}
                  onChange={(e) => setApplicantId(e.target.value)}
                  placeholder="Paste applicant ID"
                  required
                />
                <span className="text-[10px] uppercase tracking-widest text-ink/40 mt-2 block">Dry-run all active criteria against this applicant&apos;s answers. No status is written.</span>
              </div>

              <div className="flex gap-4 justify-end">
                <button
                  type="submit"
                  disabled={evaluating}
                  className="bg-saffron hover:bg-saffron-deep text-parchment px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-colors shadow-pop disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {evaluating ? 'Evaluating…' : 'Run Evaluation'}
                </button>
              </div>
            </form>

            {evalError && (
              <div className="mt-8 pt-6 border-t border-hairline">
                <div className="border border-terracotta bg-terracotta/5 text-terracotta px-4 py-3 text-sm font-sans">{evalError}</div>
              </div>
            )}

            {evalResult && (
              <div className="mt-8 pt-6 border-t border-hairline flex flex-col gap-6">
                <div className={`px-6 py-5 border-2 ${evalResult.eligible ? 'border-forest bg-forest/5' : 'border-terracotta bg-terracotta/5'}`}>
                  <div className="text-[10px] uppercase tracking-widest font-semibold text-ink/50 mb-1">Verdict</div>
                  <div className={`font-serif text-3xl font-bold ${evalResult.eligible ? 'text-forest' : 'text-terracotta'}`}>
                    {evalResult.eligible ? 'Eligible' : 'Ineligible'}
                  </div>
                </div>

                {evalResult.results.length === 0 ? (
                  <p className="text-ink/60 text-sm">No active criteria to evaluate against.</p>
                ) : (
                  <div className="border border-hairline">
                    {evalResult.results.map((r) => (
                      <div key={r.criteriaId} className="flex items-start gap-3 px-4 py-3 border-b border-hairline last:border-0">
                        <span className={`mt-0.5 text-xs font-bold uppercase tracking-widest px-2 py-1 border ${r.passed ? 'border-forest text-forest bg-forest/5' : 'border-terracotta text-terracotta bg-terracotta/5'}`}>
                          {r.passed ? 'Pass' : 'Fail'}
                        </span>
                        <span className="text-sm font-sans text-ink/80 leading-relaxed">{r.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
