'use client';

import Link from 'next/link';

export default function HomePage() {
  return (
    <div>
      {/* Hero Section */}
      <section style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--gradient-hero)',
        padding: 'var(--space-2xl)',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Animated background orbs */}
        <div style={{
          position: 'absolute', top: '20%', left: '10%', width: 300, height: 300,
          borderRadius: '50%', background: 'rgba(99, 102, 241, 0.08)',
          filter: 'blur(80px)', animation: 'float 8s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: '20%', right: '10%', width: 400, height: 400,
          borderRadius: '50%', background: 'rgba(139, 92, 246, 0.06)',
          filter: 'blur(100px)', animation: 'float 10s ease-in-out infinite reverse',
        }} />

        <div className="animate-fade-in" style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: '3.5rem', marginBottom: 'var(--space-md)' }}>⬡</div>
          <h1 style={{
            fontSize: 'clamp(2.5rem, 5vw, 4rem)',
            fontWeight: 800,
            background: 'var(--gradient-primary)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            lineHeight: 1.1,
            marginBottom: 'var(--space-lg)',
          }}>
            Join the Next Batch
          </h1>
          <p style={{
            fontSize: 'clamp(1rem, 2vw, 1.25rem)',
            color: 'var(--color-text-secondary)',
            maxWidth: 600,
            margin: '0 auto',
            lineHeight: 1.6,
            marginBottom: 'var(--space-2xl)',
          }}>
            Apply to be part of an exclusive cohort. Answer a few questions,
            get matched into a team, and start your journey.
          </p>

          <Link href="/apply" className="btn btn-primary btn-lg" style={{
            fontSize: '1.125rem',
            padding: '1rem 3rem',
            borderRadius: 'var(--radius-xl)',
          }}>
            Apply Now ✦
          </Link>

          <div style={{
            marginTop: 'var(--space-3xl)',
            display: 'flex',
            gap: 'var(--space-2xl)',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}>
            {[
              { value: '1000+', label: 'Per Batch' },
              { value: '5-25', label: 'Team Size' },
              { value: '100%', label: 'Team Matched' },
            ].map((stat) => (
              <div key={stat.label}>
                <div style={{
                  fontSize: '1.75rem', fontWeight: 700,
                  background: 'var(--gradient-primary)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  {stat.value}
                </div>
                <div className="text-sm text-muted">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section style={{
        padding: 'var(--space-3xl) var(--space-2xl)',
        maxWidth: 1000,
        margin: '0 auto',
      }}>
        <h2 style={{
          textAlign: 'center',
          fontSize: '2rem',
          fontWeight: 700,
          marginBottom: 'var(--space-2xl)',
        }}>
          How It Works
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: 'var(--space-xl)',
        }}>
          {[
            { step: 1, icon: '📝', title: 'Apply', desc: 'Fill out the questionnaire with your details and preferences.' },
            { step: 2, icon: '📦', title: 'Get Batched', desc: 'You\'ll be placed in a batch of 1000 applicants.' },
            { step: 3, icon: '🧩', title: 'Team Formation', desc: 'Our algorithm matches you into a team of 5-25 members.' },
            { step: 4, icon: '🚀', title: 'Get Started', desc: 'Finalize your consent and begin your journey with your team.' },
          ].map((item) => (
            <div key={item.step} className="card-glass animate-fade-in" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
              <div style={{
                fontSize: '2.5rem',
                marginBottom: 'var(--space-md)',
              }}>
                {item.icon}
              </div>
              <div style={{
                display: 'inline-flex',
                width: 28, height: 28,
                borderRadius: 'var(--radius-full)',
                background: 'var(--gradient-primary)',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'white',
                marginBottom: 'var(--space-sm)',
              }}>
                {item.step}
              </div>
              <h3 style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>{item.title}</h3>
              <p className="text-sm text-secondary">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{
        padding: 'var(--space-3xl) var(--space-2xl)',
        textAlign: 'center',
        background: 'var(--color-bg-secondary)',
        borderTop: '1px solid var(--color-border)',
      }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: 'var(--space-md)' }}>
          Ready to Join?
        </h2>
        <p className="text-secondary" style={{ marginBottom: 'var(--space-xl)', maxWidth: 500, margin: '0 auto var(--space-xl)' }}>
          Applications are open. Join the next available batch and get matched with your team.
        </p>
        <Link href="/apply" className="btn btn-primary btn-lg">
          Apply Now →
        </Link>
      </section>

      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-30px) rotate(5deg); }
        }
      `}</style>
    </div>
  );
}
