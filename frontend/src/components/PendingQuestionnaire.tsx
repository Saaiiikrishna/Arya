'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Clock, CheckCircle, AlertTriangle } from 'lucide-react';

interface Props {
  firstName: string;
  accessToken?: string;
}

export default function PendingQuestionnaire({ firstName, accessToken }: Props) {
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getPendingQuestionnaires()
      .then((data) => setPending(data.instructions || []))
      .catch(() => setPending([]))
      .finally(() => setLoading(false));
  }, []);

  const getTimeRemaining = (deadline: string) => {
    const now = new Date().getTime();
    const end = new Date(deadline).getTime();
    const diff = end - now;
    if (diff <= 0) return { expired: true, text: 'Deadline passed' };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (days > 0) return { expired: false, text: `${days}d ${hours}h remaining` };
    if (hours > 0) return { expired: false, text: `${hours}h ${mins}m remaining` };
    return { expired: false, text: `${mins}m remaining`, urgent: true };
  };

  const handleSubmit = async (instructionId: string, questions: any[]) => {
    if (!accessToken) return;
    const answerArr = questions
      .filter((q) => answers[q.id] !== undefined && answers[q.id] !== '')
      .map((q) => ({
        questionId: q.id,
        value: answers[q.id],
      }));

    if (answerArr.length < questions.length) {
      alert('Please answer all questions before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      await api.submitAdditionalAnswers(accessToken, answerArr);
      setSubmitted((prev) => new Set(prev).add(instructionId));
      setPending((prev) => prev.filter((p) => p.instructionId !== instructionId));
    } catch (err: any) {
      alert(err.message || 'Failed to submit answers');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || pending.length === 0) return null;

  return (
    <div className="space-y-6 mb-12">
      {pending.map((inst) => {
        const timeInfo = inst.deadline ? getTimeRemaining(inst.deadline) : null;
        return (
          <div key={inst.instructionId} className="border-2 border-amber-400 bg-amber-50/50 p-0 overflow-hidden animate-fade-in">
            {/* Header Bar */}
            <div className={`px-6 py-4 ${timeInfo?.expired ? 'bg-red-600' : timeInfo?.urgent ? 'bg-amber-600' : 'bg-amber-500'} text-white`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="text-xs uppercase tracking-widest font-bold">Action Required</span>
                </div>
                {timeInfo && (
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-widest font-bold">{timeInfo.text}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Greeting + Explanation */}
            <div className="px-8 py-6 border-b border-amber-200">
              <h3 className="font-serif text-2xl font-bold text-ink mb-2">{inst.title}</h3>
              <p className="text-sm text-ink/70 leading-relaxed mb-3">
                Dear {firstName}, please carefully review and complete the following questionnaire.
              </p>
              {inst.explanation && (
                <div className="bg-white border border-amber-200 p-4 rounded text-sm text-ink/60 leading-relaxed italic">
                  💡 {inst.explanation}
                </div>
              )}
              {inst.content && (
                <p className="text-sm text-ink/50 mt-3 leading-relaxed">{inst.content}</p>
              )}
              <div className="flex items-center gap-4 mt-4 text-[10px] uppercase tracking-widest text-ink/40 font-semibold">
                <span>Progress: {inst.answeredCount}/{inst.totalCount} answered</span>
                {inst.deadline && (
                  <span className="text-amber-700">
                    Deadline: {new Date(inst.deadline).toLocaleDateString('en-US', {
                      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
            </div>

            {/* Questions */}
            <div className="px-8 py-6">
              <div className="space-y-6">
                {inst.questions.map((q: any, idx: number) => (
                  <div key={q.id} className="bg-white border border-hairline p-5">
                    <label className="block text-xs uppercase tracking-widest font-bold text-ink/50 mb-3">
                      Question {idx + 1} of {inst.questions.length}
                      {q.isRequired && <span className="text-terracotta ml-1">*</span>}
                    </label>
                    <p className="font-serif text-lg font-medium mb-4">{q.label}</p>
                    {q.helpText && (
                      <p className="text-xs text-ink/40 mb-3 italic">{q.helpText}</p>
                    )}
                    {q.type === 'TEXTAREA' || q.type === 'FREE_TEXT' ? (
                      <textarea
                        className="w-full bg-parchment/30 border border-hairline px-4 py-3 font-sans text-sm focus:outline-none focus:border-forest transition-colors resize-y min-h-[100px]"
                        value={answers[q.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                        placeholder="Type your answer here..."
                        rows={4}
                      />
                    ) : q.type === 'MULTIPLE_CHOICE' ? (
                      <div className="space-y-2">
                        {(q.options || []).map((opt: string) => (
                          <label key={opt} className="flex items-center gap-3 p-3 border border-hairline hover:bg-parchment/30 cursor-pointer transition-colors">
                            <input
                              type="radio"
                              name={q.id}
                              value={opt}
                              checked={answers[q.id] === opt}
                              onChange={() => setAnswers({ ...answers, [q.id]: opt })}
                              className="w-4 h-4 accent-forest"
                            />
                            <span className="text-sm">{opt}</span>
                          </label>
                        ))}
                      </div>
                    ) : q.type === 'CHECKBOX' ? (
                      <div className="space-y-2">
                        {(q.options || []).map((opt: string) => {
                          const selected = (answers[q.id] || []);
                          const isChecked = Array.isArray(selected) && selected.includes(opt);
                          return (
                            <label key={opt} className="flex items-center gap-3 p-3 border border-hairline hover:bg-parchment/30 cursor-pointer transition-colors">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  const arr = Array.isArray(selected) ? [...selected] : [];
                                  if (isChecked) {
                                    setAnswers({ ...answers, [q.id]: arr.filter((v: string) => v !== opt) });
                                  } else {
                                    setAnswers({ ...answers, [q.id]: [...arr, opt] });
                                  }
                                }}
                                className="w-4 h-4 accent-forest"
                              />
                              <span className="text-sm">{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : q.type === 'YES_NO' ? (
                      <div className="flex gap-4">
                        {['Yes', 'No'].map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setAnswers({ ...answers, [q.id]: opt })}
                            className={`px-8 py-3 border text-sm uppercase tracking-widest font-bold transition-colors ${
                              answers[q.id] === opt
                                ? 'bg-forest text-white border-forest'
                                : 'bg-white text-ink/60 border-hairline hover:border-forest'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        type="text"
                        className="w-full bg-parchment/30 border border-hairline px-4 py-3 font-sans text-sm focus:outline-none focus:border-forest transition-colors"
                        value={answers[q.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                        placeholder="Your answer..."
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => handleSubmit(inst.instructionId, inst.questions)}
                  disabled={submitting}
                  className="bg-forest hover:opacity-90 text-white px-8 py-3 text-xs uppercase tracking-widest font-bold transition-opacity disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : `Submit ${inst.questions.length} Answer(s)`}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
