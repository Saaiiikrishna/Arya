'use client';

export default function ConsentPage() {
  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Consent & Documents</h1>
          <p className="page-subtitle">Manage consent workflows, videos, and signed agreements</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
            📹 Consent Video
          </h3>
          <p className="text-sm text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
            Upload or link a video that applicants must watch before giving consent.
          </p>
          <div className="form-group">
            <label className="form-label">Video URL</label>
            <input className="form-input" placeholder="https://youtube.com/watch?v=..." />
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 'var(--space-md)' }}>
            Save Video URL
          </button>
        </div>

        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
            📄 Agreement Document
          </h3>
          <p className="text-sm text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
            Upload the agreement document that users will be asked to sign via Adobe Suite.
          </p>
          <div className="form-group">
            <label className="form-label">Document</label>
            <input type="file" className="form-input" accept=".pdf,.doc,.docx" />
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 'var(--space-md)' }}>
            Upload Document
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 'var(--space-xl)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
          Consent Workflow
        </h3>
        <div style={{
          display: 'flex', gap: 'var(--space-xl)', alignItems: 'center',
          padding: 'var(--space-lg) 0',
          flexWrap: 'wrap',
        }}>
          {['Watch Video', 'Review Agreement', 'Check Consent Box', 'Upload Signed Doc', 'Verified'].map((step, i) => (
            <div key={i} className="flex items-center gap-md">
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--radius-full)',
                background: 'var(--gradient-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.8125rem', color: 'white',
              }}>
                {i + 1}
              </div>
              <span className="text-sm font-semibold">{step}</span>
              {i < 4 && <span className="text-muted">→</span>}
            </div>
          ))}
        </div>
        <p className="text-sm text-muted" style={{ marginTop: 'var(--space-md)' }}>
          Users will go through this workflow on the consent page. Adobe Suite PDF signature requests are handled externally.
        </p>
      </div>
    </div>
  );
}
