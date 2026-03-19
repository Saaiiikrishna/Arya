'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';

export default function ApplyPage() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(0); // 0 = personal info, 1+ = question pages
  const [form, setForm] = useState({
    email: '', firstName: '', lastName: '', phone: '',
  });
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    api.getPublicQuestions('INITIAL').then(setQuestions).finally(() => setLoading(false));
  }, []);

  const QUESTIONS_PER_PAGE = 4;
  const totalQuestionPages = Math.ceil(questions.length / QUESTIONS_PER_PAGE);
  const totalSteps = 1 + totalQuestionPages; // personal + question pages
  const isLastStep = step >= totalSteps - 1;

  const currentQuestions = step > 0
    ? questions.slice((step - 1) * QUESTIONS_PER_PAGE, step * QUESTIONS_PER_PAGE)
    : [];

  const handleNext = () => {
    if (step === 0) {
      if (!form.email || !form.firstName || !form.lastName) {
        setError('Please fill in all required fields');
        return;
      }
    }
    setError('');
    setStep((s) => s + 1);
  };

  const handleBack = () => setStep((s) => Math.max(0, s - 1));

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const answerArray = Object.entries(answers).map(([questionId, value]) => ({
        questionId, value,
      }));

      const result = await api.apply({
        ...form,
        answers: answerArray,
      });

      // Store access token for status page
      if (typeof window !== 'undefined') {
        localStorage.setItem('arya_access_token', result.accessToken);
      }

      router.push(`/apply/success?batch=${result.batchNumber}`);
    } catch (err: any) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const renderQuestionInput = (q: any) => {
    const value = answers[q.id] ?? '';

    switch (q.type) {
      case 'TEXT':
      case 'EMAIL':
      case 'PHONE':
      case 'URL':
        return (
          <input
            className="form-input"
            type={q.type === 'EMAIL' ? 'email' : q.type === 'PHONE' ? 'tel' : q.type === 'URL' ? 'url' : 'text'}
            value={value}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            required={q.isRequired}
          />
        );
      case 'TEXTAREA':
        return (
          <textarea
            className="form-input form-textarea"
            value={value}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            required={q.isRequired}
            rows={4}
          />
        );
      case 'NUMBER':
        return (
          <input
            className="form-input"
            type="number"
            value={value}
            onChange={(e) => setAnswers({ ...answers, [q.id]: Number(e.target.value) })}
            required={q.isRequired}
          />
        );
      case 'DATE':
        return (
          <input
            className="form-input"
            type="date"
            value={value}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            required={q.isRequired}
          />
        );
      case 'BOOLEAN':
        return (
          <div className="flex gap-md">
            {['Yes', 'No'].map((opt) => (
              <label key={opt} className="flex items-center gap-sm">
                <input
                  type="radio"
                  name={q.id}
                  checked={value === (opt === 'Yes')}
                  onChange={() => setAnswers({ ...answers, [q.id]: opt === 'Yes' })}
                />
                <span className="text-sm">{opt}</span>
              </label>
            ))}
          </div>
        );
      case 'SELECT':
        return (
          <select
            className="form-input form-select"
            value={value}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            required={q.isRequired}
          >
            <option value="">Select an option...</option>
            {(q.options || []).map((opt: any) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        );
      case 'MULTISELECT':
        return (
          <div className="flex flex-col gap-sm">
            {(q.options || []).map((opt: any) => (
              <label key={opt.value} className="flex items-center gap-sm">
                <input
                  type="checkbox"
                  checked={(value || []).includes(opt.value)}
                  onChange={(e) => {
                    const current = value || [];
                    const updated = e.target.checked
                      ? [...current, opt.value]
                      : current.filter((v: string) => v !== opt.value);
                    setAnswers({ ...answers, [q.id]: updated });
                  }}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </div>
        );
      default:
        return <input className="form-input" value={value} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />;
    }
  };

  if (loading) {
    return <div className="loading-page" style={{ minHeight: '100vh' }}><div className="spinner" /> Loading form...</div>;
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--gradient-hero)',
      padding: 'var(--space-xl)',
    }}>
      <div className="card-glass animate-fade-in" style={{ width: '100%', maxWidth: 600, padding: 'var(--space-2xl)' }}>
        {/* Progress */}
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="flex justify-between text-xs text-muted" style={{ marginBottom: 6 }}>
            <span>Step {step + 1} of {totalSteps}</span>
            <span>{Math.round(((step + 1) / totalSteps) * 100)}%</span>
          </div>
          <div style={{
            height: 4, background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-full)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${((step + 1) / totalSteps) * 100}%`,
              background: 'var(--gradient-primary)',
              borderRadius: 'var(--radius-full)',
              transition: 'width var(--transition-slow)',
            }} />
          </div>
        </div>

        {error && (
          <div style={{
            padding: '0.625rem', marginBottom: 'var(--space-md)',
            background: 'var(--color-error-bg)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-error)', fontSize: '0.8125rem',
          }}>
            {error}
          </div>
        )}

        {/* Step 0: Personal Info */}
        {step === 0 && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 'var(--space-xs)' }}>
              Personal Information
            </h2>
            <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-xl)' }}>
              Let&apos;s start with your basic details
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">First Name *</label>
                  <input className="form-input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Last Name *</label>
                  <input className="form-input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
          </div>
        )}

        {/* Question Steps */}
        {step > 0 && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 'var(--space-xs)' }}>
              Questions
            </h2>
            <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-xl)' }}>
              Page {step} of {totalQuestionPages}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
              {currentQuestions.map((q) => (
                <div key={q.id} className="form-group">
                  <label className="form-label">
                    {q.label} {q.isRequired && <span style={{ color: 'var(--color-error)' }}>*</span>}
                  </label>
                  {q.helpText && <span className="text-xs text-muted">{q.helpText}</span>}
                  {renderQuestionInput(q)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between" style={{ marginTop: 'var(--space-2xl)' }}>
          <button
            className="btn btn-secondary"
            onClick={handleBack}
            disabled={step === 0}
          >
            ← Back
          </button>
          {isLastStep ? (
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? <><div className="spinner" /> Submitting...</> : 'Submit Application ✦'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleNext}>
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
