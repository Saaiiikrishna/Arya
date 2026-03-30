import { useState } from 'react';
import Layout from './components/Layout';
import Manifesto from './components/Manifesto';
import Dossier from './components/Dossier';
import Pledge from './components/Pledge';
import WaitingRoom from './components/WaitingRoom';
import Hub from './components/Hub';

type AppStep = 'manifesto' | 'apply' | 'pledge' | 'waiting' | 'hub' | 'archives';

export default function App() {
  const [currentStep, setCurrentStep] = useState<AppStep>('manifesto');

  const renderContent = () => {
    switch (currentStep) {
      case 'manifesto':
        return <Manifesto onApply={() => setCurrentStep('apply')} />;
      case 'apply':
        return <Dossier onSubmit={() => setCurrentStep('pledge')} />;
      case 'pledge':
        return <Pledge onCommit={() => setCurrentStep('waiting')} onClose={() => setCurrentStep('manifesto')} />;
      case 'waiting':
        return <WaitingRoom onComplete={() => setCurrentStep('hub')} />;
      case 'hub':
        return <Hub />;
      case 'archives':
        return (
          <div className="min-h-[60vh] flex items-center justify-center">
            <div className="text-center max-w-md">
              <h2 className="font-serif text-4xl mb-4">The Archives</h2>
              <p className="text-ink/60 font-sans uppercase tracking-widest text-xs">Access Restricted to Verified Members</p>
            </div>
          </div>
        );
      default:
        return <Manifesto onApply={() => setCurrentStep('apply')} />;
    }
  };

  // Special layouts for Pledge and WaitingRoom (they handle their own headers or need full screen)
  if (currentStep === 'pledge') {
    return renderContent();
  }

  if (currentStep === 'waiting') {
    return renderContent();
  }

  // Hub has its own sidebar layout
  if (currentStep === 'hub') {
    return renderContent();
  }

  return (
    <Layout 
      activeTab={currentStep === 'apply' ? 'apply' : currentStep === 'archives' ? 'archives' : 'manifesto'}
      onTabChange={(tab) => setCurrentStep(tab)}
    >
      {renderContent()}
    </Layout>
  );
}
