'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface Props {
  teamId: string;
}

// Question types supported by the election question DTO (label/type/options/isRequired).
const QUESTION_TYPES = ['TEXT', 'TEXTAREA', 'SELECT', 'MULTISELECT', 'BOOLEAN', 'NUMBER'];

export default function AdminElectionControls({ teamId }: Props) {
  const [election, setElection] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  // Election question templates are global (not team-scoped); loaded lazily when
  // the admin opens the question panel so we don't fetch them per team card.
  const [showQuestions, setShowQuestions] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  // New template form (reusable library) and attach-custom-question form (this election).
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    label: '',
    helpText: '',
    type: 'TEXT',
    options: '',
    isRequired: false,
  });
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm] = useState({
    label: '',
    helpText: '',
    type: 'TEXT',
    options: '',
    isRequired: false,
  });

  useEffect(() => {
    api.getActiveElection(teamId)
      .then(setElection)
      .catch(() => setElection(null))
      .finally(() => setLoading(false));
  }, [teamId]);

  const loadTemplates = async () => {
    try {
      const data = await api.getElectionQuestionTemplates();
      setTemplates(data || []);
    } catch {
      setTemplates([]);
    } finally {
      setTemplatesLoaded(true);
    }
  };

  const handleToggleQuestions = () => {
    const next = !showQuestions;
    setShowQuestions(next);
    if (next && !templatesLoaded) {
      loadTemplates();
    }
  };

  const handleAdvance = async () => {
    if (!election?.id) return;
    try {
      const result = await api.advanceElection(election.id);
      alert(
        result.unanimous
          ? `Sole nominee auto-elected as leader!`
          : result.status === 'VOTING'
          ? 'Moved to voting phase'
          : `Election completed! Winner selected.`
      );
      const updated = await api.getActiveElection(teamId);
      setElection(updated);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // SELECT/MULTISELECT options are entered as one-per-line and sent as a string[].
  const parseOptions = (type: string, raw: string): string[] | undefined => {
    if (type !== 'SELECT' && type !== 'MULTISELECT') return undefined;
    const opts = raw
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);
    return opts.length ? opts : undefined;
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create-template');
    try {
      await api.createElectionQuestionTemplate({
        label: templateForm.label,
        helpText: templateForm.helpText || undefined,
        type: templateForm.type,
        options: parseOptions(templateForm.type, templateForm.options),
        isRequired: templateForm.isRequired,
      });
      setTemplateForm({ label: '', helpText: '', type: 'TEXT', options: '', isRequired: false });
      setShowTemplateForm(false);
      await loadTemplates();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Delete this election question template? This only removes the reusable template.')) return;
    setBusy(`del-template-${id}`);
    try {
      await api.deleteElectionQuestionTemplate(id);
      await loadTemplates();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy('');
    }
  };

  // Attach a template's question to THIS election (createElectionQuestions === POST
  // /admin/elections/:id/questions, the addCustomQuestion endpoint).
  const handleAttachTemplate = async (t: any) => {
    if (!election?.id) return;
    setBusy(`attach-${t.id}`);
    try {
      await api.createElectionQuestions(election.id, {
        label: t.label,
        helpText: t.helpText || undefined,
        type: t.type || undefined,
        options: t.options || undefined,
        isRequired: t.isRequired ?? undefined,
      });
      alert(`Added "${t.label}" to this election.`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleAddCustomQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!election?.id) return;
    setBusy('add-custom');
    try {
      await api.createElectionQuestions(election.id, {
        label: customForm.label,
        helpText: customForm.helpText || undefined,
        type: customForm.type,
        options: parseOptions(customForm.type, customForm.options),
        isRequired: customForm.isRequired,
      });
      setCustomForm({ label: '', helpText: '', type: 'TEXT', options: '', isRequired: false });
      setShowCustomForm(false);
      alert('Custom question added to this election.');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy('');
    }
  };

  if (loading) return null;

  return (
    <div className="mt-4 pt-4 border-t border-hairline">
      {/* ── Active election (existing controls, preserved) ── */}
      {!election ? (
        <p className="text-[10px] uppercase tracking-widest text-ink/30 font-bold">No active election</p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-saffron-deep font-bold">
              🗳 Election: {election.status}
            </span>
            <span className="text-[10px] text-ink/40 uppercase tracking-widest">
              {election._count?.nominations || 0} nom. · {election._count?.votes || 0} votes
            </span>
          </div>
          {election.status !== 'COMPLETED' && (
            <button
              onClick={handleAdvance}
              className="w-full text-[10px] uppercase tracking-widest font-bold border border-saffron text-saffron-deep px-3 py-2 hover:bg-saffron hover:text-white transition-colors mt-2"
            >
              {election.status === 'NOMINATION' ? 'Advance to Voting →' : 'Finalize Results →'}
            </button>
          )}
          {election.status === 'COMPLETED' && (
            <p className="text-[10px] text-forest font-bold uppercase tracking-widest">✅ Leader elected</p>
          )}
        </>
      )}

      {/* ── Election question management ── */}
      <div className="mt-3 pt-3 border-t border-hairline">
        <button
          onClick={handleToggleQuestions}
          className="text-[10px] uppercase tracking-widest font-bold border border-forest/30 text-forest px-3 py-1.5 hover:bg-forest hover:text-white transition-colors"
        >
          {showQuestions ? 'Close Questions' : 'Manage Questions'}
        </button>

        {showQuestions && (
          <div className="mt-3">
            {/* Template library */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-ink/60 font-bold">Question Templates</span>
              <button
                onClick={() => setShowTemplateForm((v) => !v)}
                disabled={!!busy}
                className="text-[10px] uppercase tracking-widest font-bold border border-forest/30 text-forest px-2 py-1 hover:bg-forest hover:text-white transition-colors disabled:opacity-50"
              >
                {showTemplateForm ? 'Close' : '+ Template'}
              </button>
            </div>

            {showTemplateForm && (
              <form onSubmit={handleCreateTemplate} className="flex flex-col gap-2 mb-3 bg-parchment/50 border border-hairline p-3">
                <input
                  className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                  placeholder="Question label *"
                  value={templateForm.label}
                  onChange={(e) => setTemplateForm({ ...templateForm, label: e.target.value })}
                  required
                />
                <input
                  className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                  placeholder="Help text (optional)"
                  value={templateForm.helpText}
                  onChange={(e) => setTemplateForm({ ...templateForm, helpText: e.target.value })}
                />
                <select
                  className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                  value={templateForm.type}
                  onChange={(e) => setTemplateForm({ ...templateForm, type: e.target.value })}
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {(templateForm.type === 'SELECT' || templateForm.type === 'MULTISELECT') && (
                  <textarea
                    className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors resize-y"
                    placeholder="One option per line"
                    rows={3}
                    value={templateForm.options}
                    onChange={(e) => setTemplateForm({ ...templateForm, options: e.target.value })}
                  />
                )}
                <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-ink/60 font-bold">
                  <input
                    type="checkbox"
                    checked={templateForm.isRequired}
                    onChange={(e) => setTemplateForm({ ...templateForm, isRequired: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  type="submit"
                  disabled={busy === 'create-template'}
                  className="bg-saffron text-parchment px-3 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-saffron-deep transition-colors disabled:opacity-50"
                >
                  {busy === 'create-template' ? 'Saving...' : 'Save Template'}
                </button>
              </form>
            )}

            {!templatesLoaded ? (
              <p className="text-[10px] uppercase tracking-widest text-ink/40">Loading templates…</p>
            ) : templates.length === 0 ? (
              <p className="text-[10px] uppercase tracking-widest text-ink/40 mb-2">No templates yet</p>
            ) : (
              <div className="flex flex-col gap-1.5 mb-3">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-start justify-between gap-2 bg-white border border-hairline p-2">
                    <div className="min-w-0">
                      <p className="text-xs text-ink/80 truncate">{t.label}</p>
                      <span className="text-[9px] uppercase tracking-widest text-ink/40">
                        {t.type || 'TEXT'}{t.isRequired ? ' · required' : ''}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {election && election.status !== 'COMPLETED' && (
                        <button
                          onClick={() => handleAttachTemplate(t)}
                          disabled={busy === `attach-${t.id}`}
                          className="text-[9px] uppercase tracking-widest font-bold border border-saffron text-saffron-deep px-2 py-1 hover:bg-saffron hover:text-white transition-colors disabled:opacity-50"
                          title="Attach this question to the active election"
                        >
                          {busy === `attach-${t.id}` ? '…' : '+ Add'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteTemplate(t.id)}
                        disabled={busy === `del-template-${t.id}`}
                        className="text-[9px] uppercase tracking-widest font-bold border border-ink/20 text-ink/50 px-2 py-1 hover:bg-ink hover:text-white transition-colors disabled:opacity-50"
                        title="Delete template"
                      >
                        {busy === `del-template-${t.id}` ? '…' : 'Del'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Attach a one-off custom question directly to this election */}
            {election && election.status !== 'COMPLETED' && (
              <div className="pt-2 border-t border-hairline">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-widest text-ink/60 font-bold">Custom Question</span>
                  <button
                    onClick={() => setShowCustomForm((v) => !v)}
                    disabled={!!busy}
                    className="text-[10px] uppercase tracking-widest font-bold border border-forest/30 text-forest px-2 py-1 hover:bg-forest hover:text-white transition-colors disabled:opacity-50"
                  >
                    {showCustomForm ? 'Close' : '+ Custom'}
                  </button>
                </div>

                {showCustomForm && (
                  <form onSubmit={handleAddCustomQuestion} className="flex flex-col gap-2 bg-parchment/50 border border-hairline p-3">
                    <input
                      className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                      placeholder="Question label *"
                      value={customForm.label}
                      onChange={(e) => setCustomForm({ ...customForm, label: e.target.value })}
                      required
                    />
                    <input
                      className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                      placeholder="Help text (optional)"
                      value={customForm.helpText}
                      onChange={(e) => setCustomForm({ ...customForm, helpText: e.target.value })}
                    />
                    <select
                      className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                      value={customForm.type}
                      onChange={(e) => setCustomForm({ ...customForm, type: e.target.value })}
                    >
                      {QUESTION_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    {(customForm.type === 'SELECT' || customForm.type === 'MULTISELECT') && (
                      <textarea
                        className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors resize-y"
                        placeholder="One option per line"
                        rows={3}
                        value={customForm.options}
                        onChange={(e) => setCustomForm({ ...customForm, options: e.target.value })}
                      />
                    )}
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-ink/60 font-bold">
                      <input
                        type="checkbox"
                        checked={customForm.isRequired}
                        onChange={(e) => setCustomForm({ ...customForm, isRequired: e.target.checked })}
                      />
                      Required
                    </label>
                    <button
                      type="submit"
                      disabled={busy === 'add-custom'}
                      className="bg-saffron text-parchment px-3 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-saffron-deep transition-colors disabled:opacity-50"
                    >
                      {busy === 'add-custom' ? 'Adding...' : 'Add to Election'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
