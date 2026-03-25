'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div style={{ backgroundColor: 'var(--color-bg-primary)', overflow: 'hidden' }}>
      {/* ─── Hero Section ────────────────────────────────────────────── */}
      <section style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        padding: 'var(--space-2xl) var(--space-md)',
        textAlign: 'center',
        zIndex: 1,
      }}>
        {/* Dynamic Abstract Background */}
        <div className="bg-mesh" />
        <div style={{
          position: 'absolute', top: '15%', left: '15%', width: '40vw', height: '40vw',
          borderRadius: '50%', background: 'var(--color-accent-glow)',
          filter: 'blur(120px)', animation: 'float-slow 12s ease-in-out infinite',
          opacity: 0.6, zIndex: -1
        }} />
        <div style={{
          position: 'absolute', bottom: '10%', right: '15%', width: '35vw', height: '35vw',
          borderRadius: '50%', background: 'rgba(139, 92, 246, 0.15)',
          filter: 'blur(100px)', animation: 'float-slow 15s ease-in-out infinite reverse',
          opacity: 0.5, zIndex: -1
        }} />

        {/* Content */}
        <div className={`animate-fade-up ${mounted ? 'visible' : ''}`} style={{ 
          position: 'relative', zIndex: 10, maxWidth: 900 
        }}>
          <div className="hero-badge">
            <span className="live-dot"></span> Applications Open for Batch #1
          </div>
          
          <h1 className="hero-title">
            Unlock Your <br/>
            <span className="text-gradient">Ultimate Potential</span>
          </h1>
          
          <p className="hero-subtitle">
            Join the most exclusive cohort of innovators. Answer a few questions, 
            get optimally matched into a high-performance team, and begin your journey.
          </p>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/apply" className="btn-premium">
              <span className="btn-content">Apply Now <span className="arrow">→</span></span>
            </Link>
            <Link href="/admin/login" className="btn-premium-outline">
              <span className="btn-content">Admin Login</span>
            </Link>
          </div>

          {/* Stats Glass Strip */}
          <div className="stats-glass-strip">
            {[
              { label: 'Total Capacity', value: '1,000+' },
              { label: 'Team Size Range', value: '5 - 25' },
              { label: 'Success Match Rate', value: '100%' },
            ].map((stat, idx) => (
              <div key={idx} className="stat-item">
                <div className="stat-val text-gradient">{stat.value}</div>
                <div className="stat-lbl">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── The Journey (How it Works) ────────────────────────────── */}
      <section style={{
        padding: '8rem 2rem',
        position: 'relative',
        background: 'var(--color-bg-secondary)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ 
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '80%', height: '1px', background: 'var(--gradient-primary)', opacity: 0.3
        }} />
        
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '5rem' }}>
            <h2 className="section-title">The Masterplan</h2>
            <p className="section-subtitle">A seamless journey from application to team formation.</p>
          </div>

          <div className="timeline-grid">
            {[
              { step: '01', title: 'The Application', desc: 'Secure your spot by detailing your expertise, vision, and preferences.', icon: '⚡' },
              { step: '02', title: 'Smart Batching', desc: 'Enter the processing pool where our algorithm analyzes your profile.', icon: '🔮' },
              { step: '03', title: 'Team Synthesis', desc: 'Get perfectly matched with 5-25 peers who complement your skills.', icon: '🤝' },
              { step: '04', title: 'Launch', desc: 'Finalize your consent, meet your team, and start building the future.', icon: '🚀' },
            ].map((item, i) => (
              <div key={i} className="timeline-card">
                <div className="timeline-glow"></div>
                <div className="timeline-step">{item.step}</div>
                <div className="timeline-icon">{item.icon}</div>
                <h3 className="timeline-title">{item.title}</h3>
                <p className="timeline-desc">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Footer CTA ────────────────────────────────────────────── */}
      <section style={{
        padding: '6rem 2rem',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div className="cta-glow-bg"></div>
        <div className="card-glass" style={{
          maxWidth: 800, margin: '0 auto', padding: '4rem 2rem',
          position: 'relative', zIndex: 2, border: '1px solid rgba(99, 102, 241, 0.2)'
        }}>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '1rem' }}>
            Your future team is waiting.
          </h2>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: '2rem', fontSize: '1.2rem' }}>
            Don't miss the chance to be part of Batch #1.
          </p>
          <Link href="/apply" className="btn-premium" style={{ display: 'inline-flex' }}>
            <span className="btn-content">Begin Application ✦</span>
          </Link>
        </div>
      </section>

      {/* ─── STYLES ─────────────────────────────────────────────────── */}
      <style jsx>{`
        /* Animations */
        @keyframes float-slow {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-40px) scale(1.05); }
        }
        @keyframes spin-slow {
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse-ring {
          0% { transform: scale(0.8); box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(99, 102, 241, 0); }
          100% { transform: scale(0.8); box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
        }

        .animate-fade-up {
          opacity: 0;
          transform: translateY(30px);
          transition: opacity 1s cubic-bezier(0.16, 1, 0.3, 1), transform 1s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .animate-fade-up.visible {
          opacity: 1;
          transform: translateY(0);
        }

        /* Abstract Background */
        .bg-mesh {
          position: absolute;
          inset: 0;
          background-image: 
            radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.1) 0px, transparent 50%),
            radial-gradient(at 100% 0%, rgba(139, 92, 246, 0.1) 0px, transparent 50%),
            radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.05) 0px, transparent 50%);
          z-index: -2;
        }

        /* Typography */
        .text-gradient {
          background: linear-gradient(135deg, #a78bfa 0%, #6366f1 50%, #38bdf8 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        
        .hero-title {
          font-size: clamp(3rem, 8vw, 6rem);
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: -0.03em;
          margin-bottom: 1.5rem;
          color: white;
        }

        .hero-subtitle {
          font-size: clamp(1.1rem, 2vw, 1.4rem);
          color: var(--color-text-secondary);
          max-width: 700px;
          margin: 0 auto 3rem;
          line-height: 1.6;
        }

        .section-title {
          font-size: clamp(2rem, 4vw, 3rem);
          font-weight: 800;
          margin-bottom: 1rem;
          color: white;
        }
        .section-subtitle {
          font-size: 1.2rem;
          color: var(--color-text-secondary);
        }

        /* Hero Badge */
        .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.3);
          padding: 0.5rem 1.2rem;
          border-radius: 99px;
          font-size: 0.9rem;
          font-weight: 600;
          color: #a78bfa;
          margin-bottom: 2rem;
          backdrop-filter: blur(10px);
        }
        .live-dot {
          width: 8px; height: 8px;
          background-color: var(--color-info);
          border-radius: 50%;
          animation: pulse-ring 2s infinite;
        }

        /* Buttons */
        .btn-premium {
          position: relative;
          display: inline-flex;
          padding: 1px;
          border-radius: 99px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6, #3b82f6);
          text-decoration: none;
          overflow: hidden;
          transition: transform 0.3s ease;
        }
        .btn-premium:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 40px -10px rgba(99,102,241,0.6);
        }
        .btn-premium .btn-content {
          background: #12121e;
          padding: 1rem 2.5rem;
          border-radius: 99px;
          color: white;
          font-weight: 600;
          font-size: 1.1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          transition: background 0.3s ease;
        }
        .btn-premium:hover .btn-content {
          background: transparent;
        }
        .arrow {
          transition: transform 0.3s ease;
        }
        .btn-premium:hover .arrow {
          transform: translateX(4px);
        }

        .btn-premium-outline {
          display: inline-flex;
          padding: 1rem 2.5rem;
          border-radius: 99px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          font-weight: 600;
          font-size: 1.1rem;
          backdrop-filter: blur(10px);
          transition: all 0.3s ease;
        }
        .btn-premium-outline:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: translateY(-2px);
        }

        /* Stats Strip */
        .stats-glass-strip {
          display: flex;
          justify-content: center;
          gap: 3rem;
          margin-top: 4rem;
          padding: 2rem 4rem;
          background: rgba(20, 20, 35, 0.4);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 24px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.2);
        }
        @media (max-width: 768px) {
          .stats-glass-strip { flex-direction: column; gap: 2rem; padding: 2rem; }
        }
        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .stat-val {
          font-size: 2.5rem;
          font-weight: 800;
          line-height: 1;
          margin-bottom: 0.5rem;
        }
        .stat-lbl {
          font-size: 0.9rem;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 500;
        }

        /* Timeline / Cards */
        .timeline-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 2rem;
        }
        .timeline-card {
          position: relative;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          padding: 2.5rem 2rem;
          border-radius: 20px;
          overflow: hidden;
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .timeline-card:hover {
          background: rgba(255, 255, 255, 0.04);
          transform: translateY(-8px);
          border-color: rgba(99, 102, 241, 0.3);
          box-shadow: 0 20px 40px rgba(0,0,0,0.4);
        }
        .timeline-glow {
          position: absolute;
          top: 0; left: 0; width: 100%; height: 100%;
          background: radial-gradient(circle at 50% 0%, rgba(99,102,241,0.15), transparent 70%);
          opacity: 0;
          transition: opacity 0.4s ease;
        }
        .timeline-card:hover .timeline-glow { opacity: 1; }
        
        .timeline-step {
          font-size: 1rem;
          font-weight: 700;
          color: rgba(255,255,255,0.2);
          margin-bottom: 1.5rem;
          font-family: var(--font-mono);
          letter-spacing: 2px;
        }
        .timeline-card:hover .timeline-step {
          color: var(--color-accent);
        }
        .timeline-icon {
          font-size: 2.5rem;
          margin-bottom: 1.5rem;
        }
        .timeline-title {
          font-size: 1.4rem;
          font-weight: 700;
          color: white;
          margin-bottom: 1rem;
        }
        .timeline-desc {
          color: var(--color-text-secondary);
          line-height: 1.6;
        }

        /* Footer CTA Bg */
        .cta-glow-bg {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 80vw; height: 80vw;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 60%);
          z-index: 1;
        }
      `}</style>
    </div>
  );
}
