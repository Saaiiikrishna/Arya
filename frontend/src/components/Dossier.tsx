"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

interface ApplicationFormProps {
  onSubmit: (data: any) => void;
  defaultData?: any;
  userInfo?: { firstName?: string; lastName?: string; email?: string };
  readOnly?: boolean;
}

const IDEA_CATEGORIES = [
  { value: 'FINTECH', label: 'FinTech' },
  { value: 'HEALTHTECH', label: 'HealthTech' },
  { value: 'EDTECH', label: 'EdTech' },
  { value: 'ECOMMERCE', label: 'E-Commerce' },
  { value: 'SAAS', label: 'SaaS' },
  { value: 'SOCIAL', label: 'Social' },
  { value: 'AI_ML', label: 'AI / ML' },
  { value: 'BLOCKCHAIN', label: 'Blockchain' },
  { value: 'SUSTAINABILITY', label: 'Sustainability' },
  { value: 'LOGISTICS', label: 'Logistics' },
  { value: 'MEDIA', label: 'Media' },
  { value: 'GAMING', label: 'Gaming' },
  { value: 'OTHER', label: 'Other' },
];

const COMMITMENT_LEVELS = [
  { value: 'FULL_TIME', label: 'Full Time' },
  { value: 'PART_TIME', label: 'Part Time' },
  { value: 'WEEKENDS_ONLY', label: 'Weekends Only' },
  { value: 'FLEXIBLE', label: 'Flexible' },
];

const SKILL_SUGGESTIONS = [
  'React', 'Node.js', 'Python', 'TypeScript', 'Java', 'Go', 'Rust',
  'UI/UX Design', 'Product Management', 'Marketing', 'Sales',
  'Data Science', 'Machine Learning', 'DevOps', 'Mobile Dev',
  'Blockchain', 'Finance', 'Operations', 'Content Writing', 'SEO',
];

const TOTAL_STEPS = 5;
const DRAFT_KEY = 'arya_application_draft';

// Format phone: ensure only 10 digits, auto-prepend +91
function formatPhoneForStorage(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  // If already starts with 91 and is 12 digits, strip leading 91
  const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  const tenDigits = cleaned.slice(0, 10);
  return tenDigits.length === 10 ? `+91${tenDigits}` : raw;
}

// Strip +91 prefix for display
function phoneForDisplay(stored: string): string {
  if (stored.startsWith('+91')) return stored.slice(3);
  return stored.replace(/\D/g, '').slice(0, 10);
}

export default function ApplicationForm({ onSubmit, defaultData, userInfo, readOnly }: ApplicationFormProps) {
  const { admin, isAuthenticated } = useAuth();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Step 1: Personal Info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [age, setAge] = useState('');

  // Step 2: Skills & Experience
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState('');
  const [experienceYears, setExperienceYears] = useState('');
  const [hoursPerDay, setHoursPerDay] = useState('');
  const [commitmentLevel, setCommitmentLevel] = useState('FLEXIBLE');

  // Step 3: Idea & Category
  const [hasIdea, setHasIdea] = useState(false);
  const [ideaSummary, setIdeaSummary] = useState('');
  const [ideaCategory, setIdeaCategory] = useState('');

  // Step 4: Creative Assessment (existing dossier)
  const [vocation, setVocation] = useState('');
  const [obsession, setObsession] = useState('');
  const [heresy, setHeresy] = useState('');
  const [scarTissue, setScarTissue] = useState('');

  // Step 5: Agreement
  const [agreementAccepted, setAgreementAccepted] = useState(false);

  // Load draft from localStorage on mount
  useEffect(() => {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      try {
        const d = JSON.parse(draft);
        if (d.firstName) setFirstName(d.firstName);
        if (d.lastName) setLastName(d.lastName);
        if (d.email) setEmail(d.email);
        if (d.phone) setPhone(d.phone);
        if (d.city) setCity(d.city);
        if (d.age) setAge(d.age);
        if (d.skills) setSkills(d.skills);
        if (d.experienceYears) setExperienceYears(d.experienceYears);
        if (d.hoursPerDay) setHoursPerDay(d.hoursPerDay);
        if (d.commitmentLevel) setCommitmentLevel(d.commitmentLevel);
        if (d.hasIdea) setHasIdea(d.hasIdea);
        if (d.ideaSummary) setIdeaSummary(d.ideaSummary);
        if (d.ideaCategory) setIdeaCategory(d.ideaCategory);
        if (d.vocation) setVocation(d.vocation);
        if (d.obsession) setObsession(d.obsession);
        if (d.heresy) setHeresy(d.heresy);
        if (d.scarTissue) setScarTissue(d.scarTissue);
      } catch {}
    }
  }, []);

  // Pre-fill from user info / auth
  useEffect(() => {
    if (userInfo?.firstName && !firstName) setFirstName(userInfo.firstName);
    if (userInfo?.lastName && !lastName) setLastName(userInfo.lastName);
    if (userInfo?.email && !email) setEmail(userInfo.email);
  }, [userInfo]);

  useEffect(() => {
    if (admin?.email && !email) setEmail(admin.email);
    if (admin?.firstName && !firstName) setFirstName(admin.firstName);
    if (admin?.lastName && !lastName) setLastName(admin.lastName);
  }, [admin]);

  // Pre-fill from defaultData
  useEffect(() => {
    if (defaultData) {
      if (defaultData.firstName) setFirstName(defaultData.firstName);
      if (defaultData.lastName) setLastName(defaultData.lastName);
      if (defaultData.email) setEmail(defaultData.email);
      if (defaultData.phone && defaultData.phone.length > 5) setPhone(phoneForDisplay(defaultData.phone));
      if (defaultData.city) setCity(defaultData.city);
      if (defaultData.age) setAge(String(defaultData.age));
      
      if (defaultData.matchingProfile) {
        const mp = defaultData.matchingProfile;
        if (mp.skills && mp.skills.length > 0) setSkills(mp.skills);
        if (mp.experienceYears !== null) setExperienceYears(String(mp.experienceYears));
        if (mp.hoursPerDay !== null) setHoursPerDay(String(mp.hoursPerDay));
        if (mp.commitmentLevel) setCommitmentLevel(mp.commitmentLevel);
        if (mp.hasIdea !== undefined) setHasIdea(mp.hasIdea);
        if (mp.ideaSummary) setIdeaSummary(mp.ideaSummary);
        if (mp.ideaCategory) setIdeaCategory(mp.ideaCategory);
      }

      if (defaultData.vocation) setVocation(defaultData.vocation);
      if (defaultData.obsession) setObsession(defaultData.obsession);
      if (defaultData.heresy) setHeresy(defaultData.heresy);
      if (defaultData.scarTissue) setScarTissue(defaultData.scarTissue);
    }
  }, [defaultData]);

  // Auto-save draft
  const saveDraft = useCallback(async () => {
    const draft = {
      firstName, lastName, email, phone, city, age,
      skills, experienceYears, hoursPerDay, commitmentLevel,
      hasIdea, ideaSummary, ideaCategory,
      vocation, obsession, heresy, scarTissue,
    };
    
    if (isAuthenticated) {
      const storedPhone = phone ? formatPhoneForStorage(phone) : '';
      const payload = {
        ...draft,
        phone: storedPhone,
        age: age ? parseInt(age) : null,
        experienceYears: experienceYears ? parseInt(experienceYears) : null,
        hoursPerDay: hoursPerDay ? parseInt(hoursPerDay) : null,
      };
      
      // Do not wait for response to avoid blocking typing
      api.submitDossier(payload).catch(e => console.error("Draft autosave failed", e));
    } else {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }
  }, [firstName, lastName, email, phone, city, age, skills, experienceYears, hoursPerDay, commitmentLevel, hasIdea, ideaSummary, ideaCategory, vocation, obsession, heresy, scarTissue, isAuthenticated]);

  useEffect(() => {
    const timeout = setTimeout(saveDraft, 500);
    return () => clearTimeout(timeout);
  }, [saveDraft]);

  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {};
    if (s === 1) {
      if (!firstName.trim()) errs.firstName = 'First name is required';
      if (!email.trim()) errs.email = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Enter a valid email';
      if (!city.trim()) errs.city = 'City is required';
      if (!age || parseInt(age) < 16 || parseInt(age) > 80) errs.age = 'Valid age (16-80) is required';
      const phoneDigits = phone.replace(/\D/g, '');
      if (phone && phoneDigits.length !== 10 && !(phoneDigits.startsWith('91') && phoneDigits.length === 12)) {
        errs.phone = 'Enter a valid 10-digit mobile number';
      }
    }
    if (s === 2) {
      if (skills.length === 0) errs.skills = 'Add at least one skill';
      if (!commitmentLevel) errs.commitmentLevel = 'Select a commitment level';
      if (experienceYears && (parseInt(experienceYears) < 0 || parseInt(experienceYears) > 50)) {
        errs.experienceYears = 'Valid experience (0-50 years)';
      }
      if (hoursPerDay && (parseInt(hoursPerDay) < 1 || parseInt(hoursPerDay) > 16)) {
        errs.hoursPerDay = 'Valid hours (1-16 per day)';
      }
    }
    if (s === 3) {
      if (hasIdea && !ideaCategory) errs.ideaCategory = 'Select an idea category';
      if (hasIdea && ideaSummary.trim().length > 0 && ideaSummary.trim().length < 20) {
        errs.ideaSummary = 'Describe your idea in at least 20 characters';
      }
    }
    if (s === 4) {
      if (!vocation.trim()) errs.vocation = 'Vocation is required';
      if (!obsession.trim()) errs.obsession = 'This field is required';
      else if (obsession.trim().length < 30) errs.obsession = 'Minimum 30 characters required';
      if (!heresy.trim()) errs.heresy = 'This field is required';
      else if (heresy.trim().length < 30) errs.heresy = 'Minimum 30 characters required';
      if (!scarTissue.trim()) errs.scarTissue = 'This field is required';
      else if (scarTissue.trim().length < 30) errs.scarTissue = 'Minimum 30 characters required';
    }
    if (s === 5) {
      if (!agreementAccepted) errs.agreement = 'You must accept the agreement to proceed';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const goNext = () => {
    if (validateStep(step)) {
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const goPrev = () => {
    setErrors({});
    setStep(step - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePhoneChange = (val: string) => {
    // Allow only digits
    const digits = val.replace(/\D/g, '');
    // Cap at 10 digits
    setPhone(digits.slice(0, 10));
  };

  const handleSubmit = () => {
    if (!validateStep(5)) return;
    const storedPhone = phone ? formatPhoneForStorage(phone) : '';
    const data = {
      firstName, lastName, phone: storedPhone, city, age: parseInt(age),
      skills, experienceYears: experienceYears ? parseInt(experienceYears) : null,
      hoursPerDay: hoursPerDay ? parseInt(hoursPerDay) : null,
      commitmentLevel,
      hasIdea, ideaSummary, ideaCategory: ideaCategory || null,
      vocation, obsession, heresy, scarTissue,
      agreementAccepted: true,
    };
    localStorage.removeItem(DRAFT_KEY);
    onSubmit(data);
  };

  const addSkill = (skill: string) => {
    const trimmed = skill.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills([...skills, trimmed]);
    }
    setSkillInput('');
  };

  const removeSkill = (skill: string) => {
    setSkills(skills.filter(s => s !== skill));
  };

  const progressPercent = ((step - 1) / (TOTAL_STEPS - 1)) * 100;

  // Shared input class with proper padding
  const inputClass = (hasError?: boolean) =>
    `w-full bg-transparent border border-hairline px-4 py-3.5 focus:outline-none focus:border-forest text-lg font-serif placeholder:text-ink/25 transition-all ${
      hasError ? 'border-terracotta' : ''
    }`;

  const textareaClass = (hasError?: boolean) =>
    `w-full bg-transparent border border-hairline px-4 py-3.5 focus:outline-none focus:border-forest text-base font-sans leading-relaxed placeholder:text-ink/25 transition-all resize-none ${
      hasError ? 'border-terracotta' : ''
    }`;

  if (readOnly) {
    return (
      <div className="space-y-8 bg-parchment/30 p-8 border border-hairline relative">
        <div className="absolute top-0 right-0 py-1 px-3 border border-r-0 border-t-0 border-hairline bg-white text-ink/40 text-[10px] uppercase tracking-widest font-bold">
          Archive Record
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 font-sans text-sm">
          <div><span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-1">Name</span><strong className="text-forest">{firstName} {lastName}</strong></div>
          <div><span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-1">Email</span><strong className="text-forest">{email}</strong></div>
          <div><span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-1">Phone</span><strong className="text-forest">{phone}</strong></div>
          <div><span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-1">City</span><strong className="text-forest">{city}</strong></div>
          <div><span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-1">Age</span><strong className="text-forest">{age}</strong></div>
          
          <div className="md:col-span-2"><span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-1">Skills</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {skills.map(s => <span key={s} className="px-2 py-1 bg-white border border-hairline text-xs font-medium">{s}</span>)}
            </div>
          </div>
          <div><span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-1">Experience</span><strong className="text-forest">{experienceYears} years</strong></div>
          <div>
            <span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-1">Commitment</span>
            <strong className="text-forest">
              {COMMITMENT_LEVELS.find(c => c.value === commitmentLevel)?.label || commitmentLevel}
              {hoursPerDay ? ` (${hoursPerDay} hrs/day)` : ''}
            </strong>
          </div>
          
          <div className="md:col-span-2">
            <span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-1">Idea Details</span>
            <strong className="text-forest block mb-2">{hasIdea ? (IDEA_CATEGORIES.find(c => c.value === ideaCategory)?.label || ideaCategory) : 'No specific idea yet'}</strong>
            {hasIdea && ideaSummary && <p className="text-forest/80 whitespace-pre-wrap mt-2 p-4 bg-white border border-hairline leading-relaxed">{ideaSummary}</p>}
          </div>

          <div className="md:col-span-2 mt-4 space-y-6">
            <h4 className="font-serif text-lg font-bold text-forest border-b border-hairline pb-2">Creative Assessment</h4>
            <div>
              <span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-2 font-bold">Vocation</span>
              <p className="text-forest/80 whitespace-pre-wrap p-4 bg-white border border-hairline leading-relaxed">{vocation}</p>
            </div>
            <div>
              <span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-2 font-bold">Obsession</span>
              <p className="text-forest/80 whitespace-pre-wrap p-4 bg-white border border-hairline leading-relaxed">{obsession}</p>
            </div>
            <div>
              <span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-2 font-bold">Heresy</span>
              <p className="text-forest/80 whitespace-pre-wrap p-4 bg-white border border-hairline leading-relaxed">{heresy}</p>
            </div>
            <div>
              <span className="text-ink/50 uppercase tracking-widest text-[10px] block mb-2 font-bold">Scar Tissue</span>
              <p className="text-forest/80 whitespace-pre-wrap p-4 bg-white border border-hairline leading-relaxed">{scarTissue}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-24 px-6">
      {/* Progress Bar */}
      <div className="max-w-[640px] mx-auto mb-16">
        <div className="flex justify-between items-center mb-4">
          <span className="text-[10px] uppercase tracking-widest text-ink/50 font-bold">
            Step {step} of {TOTAL_STEPS}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-ink/50 font-bold">
            {step === 1 && 'Personal Info'}
            {step === 2 && 'Skills & Experience'}
            {step === 3 && 'Idea & Category'}
            {step === 4 && 'Creative Assessment'}
            {step === 5 && 'Review & Agreement'}
          </span>
        </div>
        <div className="h-1 bg-hairline w-full">
          <div 
            className="h-full bg-forest transition-all duration-500 ease-out" 
            style={{ width: `${progressPercent}%` }} 
          />
        </div>
        <div className="flex justify-between mt-3">
          {[1, 2, 3, 4, 5].map(s => (
            <div 
              key={s}
              className={`w-8 h-8 flex items-center justify-center text-xs font-bold border-2 transition-all ${
                s === step 
                  ? 'border-forest bg-forest text-parchment' 
                  : s < step 
                    ? 'border-forest/30 bg-forest/10 text-forest' 
                    : 'border-hairline text-ink/30'
              }`}
            >
              {s < step ? '✓' : s}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="max-w-[640px] mx-auto">

        {/* STEP 1: Personal Info */}
        {step === 1 && (
          <div className="animate-fade-in">
            <h2 className="font-serif text-4xl md:text-5xl text-forest leading-tight mb-4">
              Tell us about yourself
            </h2>
            <p className="font-serif italic text-lg text-ink/60 leading-relaxed mb-12 border-l border-terracotta pl-6 py-2">
              Basic information to help us understand who you are and where you operate.
            </p>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">First Name *</label>
                  <input
                    type="text"
                    placeholder="Aryan"
                    className={inputClass(!!errors.firstName)}
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                  />
                  {errors.firstName && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.firstName}</p>}
                </div>
                <div>
                  <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">Last Name</label>
                  <input
                    type="text"
                    placeholder="Vartham"
                    className={inputClass()}
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">Email *</label>
                <input
                  type="email"
                  placeholder="aryan@aryavartham.com"
                  className={inputClass(!!errors.email)}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  readOnly={isAuthenticated && !!admin?.email}
                  style={isAuthenticated && admin?.email ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                />
                {errors.email && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.email}</p>}
                {isAuthenticated && admin?.email && (
                  <p className="text-forest text-[10px] mt-1.5 uppercase tracking-widest">✓ Verified via login</p>
                )}
              </div>

              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">Mobile Number</label>
                <div className="flex">
                  <span className="inline-flex items-center px-4 py-3.5 bg-parchment/80 border border-r-0 border-hairline text-ink/60 font-sans text-lg font-semibold">+91</span>
                  <input
                    type="tel"
                    placeholder="9876543210"
                    maxLength={10}
                    className={`flex-1 bg-transparent border border-hairline px-4 py-3.5 focus:outline-none focus:border-forest text-lg font-serif placeholder:text-ink/25 transition-all ${errors.phone ? 'border-terracotta' : ''}`}
                    value={phone}
                    onChange={e => handlePhoneChange(e.target.value)}
                  />
                </div>
                {errors.phone && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.phone}</p>}
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">City *</label>
                  <input
                    type="text"
                    placeholder="Hyderabad"
                    className={inputClass(!!errors.city)}
                    value={city}
                    onChange={e => setCity(e.target.value)}
                  />
                  {errors.city && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.city}</p>}
                </div>
                <div>
                  <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">Age *</label>
                  <input
                    type="number"
                    placeholder="25"
                    min={16}
                    max={80}
                    className={inputClass(!!errors.age)}
                    value={age}
                    onChange={e => setAge(e.target.value)}
                  />
                  {errors.age && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.age}</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Skills & Experience */}
        {step === 2 && (
          <div className="animate-fade-in">
            <h2 className="font-serif text-4xl md:text-5xl text-forest leading-tight mb-4">
              Your craft & commitment
            </h2>
            <p className="font-serif italic text-lg text-ink/60 leading-relaxed mb-12 border-l border-terracotta pl-6 py-2">
              What do you bring to the table? We value diverse skillsets and genuine commitment over polished resumes.
            </p>

            <div className="space-y-8">
              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-3 font-semibold">Skills * <span className="text-ink/30">(tap to add, or type your own)</span></label>
                <div className="flex flex-wrap gap-2 mb-4">
                  {skills.map(skill => (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => removeSkill(skill)}
                      className="bg-forest/10 text-forest border border-forest/20 px-3 py-1.5 text-xs uppercase tracking-widest font-bold hover:bg-terracotta/10 hover:text-terracotta hover:border-terracotta/20 transition-colors"
                    >
                      {skill} ×
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    placeholder="Type a skill and press Enter..."
                    className="flex-1 bg-transparent border border-hairline px-4 py-3 focus:outline-none focus:border-forest font-sans text-sm placeholder:text-ink/25 transition-all"
                    value={skillInput}
                    onChange={e => setSkillInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(skillInput); } }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {SKILL_SUGGESTIONS.filter(s => !skills.includes(s)).slice(0, 12).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => addSkill(s)}
                      className="border border-hairline px-3 py-1.5 text-[10px] uppercase tracking-widest text-ink/50 hover:border-forest hover:text-forest transition-colors"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
                {errors.skills && <p className="text-terracotta text-[10px] mt-2 uppercase tracking-widest">{errors.skills}</p>}
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">Experience (Years)</label>
                  <input
                    type="number"
                    placeholder="3"
                    min={0}
                    max={50}
                    className={inputClass(!!errors.experienceYears)}
                    value={experienceYears}
                    onChange={e => setExperienceYears(e.target.value)}
                  />
                  {errors.experienceYears && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.experienceYears}</p>}
                </div>
                <div>
                  <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">Availability (Hours/Day)</label>
                  <input
                    type="number"
                    placeholder="6"
                    min={1}
                    max={16}
                    className={inputClass(!!errors.hoursPerDay)}
                    value={hoursPerDay}
                    onChange={e => setHoursPerDay(e.target.value)}
                  />
                  {errors.hoursPerDay && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.hoursPerDay}</p>}
                </div>
              </div>

              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-3 font-semibold">Commitment Level *</label>
                <div className="grid grid-cols-2 gap-3">
                  {COMMITMENT_LEVELS.map(cl => (
                    <button
                      key={cl.value}
                      type="button"
                      onClick={() => setCommitmentLevel(cl.value)}
                      className={`p-4 border-2 text-left transition-all ${
                        commitmentLevel === cl.value
                          ? 'border-forest bg-forest/5'
                          : 'border-hairline hover:border-ink/30'
                      }`}
                    >
                      <span className="block font-serif text-lg font-bold">{cl.label}</span>
                    </button>
                  ))}
                </div>
                {errors.commitmentLevel && <p className="text-terracotta text-[10px] mt-2 uppercase tracking-widest">{errors.commitmentLevel}</p>}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Idea & Category */}
        {step === 3 && (
          <div className="animate-fade-in">
            <h2 className="font-serif text-4xl md:text-5xl text-forest leading-tight mb-4">
              Your vision
            </h2>
            <p className="font-serif italic text-lg text-ink/60 leading-relaxed mb-12 border-l border-terracotta pl-6 py-2">
              Whether you have a startup idea or want to join a team — both are equally valuable.
            </p>

            <div className="space-y-8">
              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-4 font-semibold">Do you have a startup idea?</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setHasIdea(true)}
                    className={`p-6 border-2 text-center transition-all ${
                      hasIdea ? 'border-forest bg-forest/5' : 'border-hairline hover:border-ink/30'
                    }`}
                  >
                    <span className="block text-3xl mb-2">💡</span>
                    <span className="block font-serif text-lg font-bold">Yes, I have an idea</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setHasIdea(false); setIdeaSummary(''); setIdeaCategory(''); }}
                    className={`p-6 border-2 text-center transition-all ${
                      !hasIdea ? 'border-forest bg-forest/5' : 'border-hairline hover:border-ink/30'
                    }`}
                  >
                    <span className="block text-3xl mb-2">🔨</span>
                    <span className="block font-serif text-lg font-bold">I want to build with a team</span>
                  </button>
                </div>
              </div>

              {hasIdea && (
                <>
                  <div>
                    <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">Idea Category {hasIdea ? '*' : ''}</label>
                    <div className="grid grid-cols-3 gap-2">
                      {IDEA_CATEGORIES.map(cat => (
                        <button
                          key={cat.value}
                          type="button"
                          onClick={() => setIdeaCategory(cat.value)}
                          className={`p-3 border text-center text-xs uppercase tracking-widest font-bold transition-all ${
                            ideaCategory === cat.value
                              ? 'border-forest bg-forest/10 text-forest'
                              : 'border-hairline text-ink/50 hover:border-ink/30'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                    {errors.ideaCategory && <p className="text-terracotta text-[10px] mt-2 uppercase tracking-widest">{errors.ideaCategory}</p>}
                  </div>
                  <div>
                    <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">Describe Your Idea</label>
                    <textarea
                      rows={5}
                      placeholder="Building an AI-powered platform that connects rural artisans in India with global buyers..."
                      className={textareaClass(!!errors.ideaSummary)}
                      value={ideaSummary}
                      onChange={e => setIdeaSummary(e.target.value)}
                    />
                    {errors.ideaSummary && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.ideaSummary}</p>}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* STEP 4: Creative Assessment */}
        {step === 4 && (
          <div className="animate-fade-in">
            <h2 className="font-serif text-4xl md:text-5xl text-forest leading-tight mb-4">
              The dossier
            </h2>
            <p className="font-serif italic text-lg text-ink/60 leading-relaxed mb-12 border-l border-terracotta pl-6 py-2">
              This section captures the nuance of your ambition. We look for the obsession that keeps you awake, the failures that shaped your resolve, and the vision that feels inevitable.
            </p>

            <div className="space-y-8">
              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">Primary Vocation *</label>
                <input
                  type="text"
                  placeholder="Full-stack engineer & product architect"
                  className={inputClass(!!errors.vocation)}
                  value={vocation}
                  onChange={e => setVocation(e.target.value)}
                />
                {errors.vocation && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.vocation}</p>}
              </div>

              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">The Obsession *</label>
                <div className="text-ink/50 text-sm font-sans italic mb-3">
                  What is the one problem you cannot stop thinking about? Describe it with the clarity of a physical object.
                </div>
                <textarea
                  rows={5}
                  placeholder="Democratizing access to startup infrastructure for first-generation founders in India..."
                  className={textareaClass(!!errors.obsession)}
                  value={obsession}
                  onChange={e => setObsession(e.target.value)}
                />
                {errors.obsession && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.obsession}</p>}
              </div>

              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">The Heresy *</label>
                <div className="text-ink/50 text-sm font-sans italic mb-3">
                  What is a truth you hold that most of your peers consider a delusion?
                </div>
                <textarea
                  rows={5}
                  placeholder="Most accelerators optimize for investor returns, not founder success. The model needs to be rebuilt from scratch..."
                  className={textareaClass(!!errors.heresy)}
                  value={heresy}
                  onChange={e => setHeresy(e.target.value)}
                />
                {errors.heresy && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.heresy}</p>}
              </div>

              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">The Scar Tissue *</label>
                <div className="text-ink/50 text-sm font-sans italic mb-3">
                  Detail a project that failed. Not a &quot;learning experience,&quot; but a genuine collapse. What remains?
                </div>
                <textarea
                  rows={5}
                  placeholder="Built a SaaS product that reached 500 users but failed to monetize. Shut down after 14 months of bootstrapped effort..."
                  className={textareaClass(!!errors.scarTissue)}
                  value={scarTissue}
                  onChange={e => setScarTissue(e.target.value)}
                />
                {errors.scarTissue && <p className="text-terracotta text-[10px] mt-1.5 uppercase tracking-widest">{errors.scarTissue}</p>}
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: Review & Agreement */}
        {step === 5 && (
          <div className="animate-fade-in">
            <h2 className="font-serif text-4xl md:text-5xl text-forest leading-tight mb-4">
              Review & pledge
            </h2>
            <p className="font-serif italic text-lg text-ink/60 leading-relaxed mb-12 border-l border-terracotta pl-6 py-2">
              Review your application and accept the founding agreement to proceed.
            </p>

            {/* Summary Cards */}
            <div className="space-y-6 mb-12">
              <div className="border border-hairline bg-white p-6">
                <h3 className="text-[10px] uppercase tracking-widest text-forest font-bold mb-4">Personal Info</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-ink/40">Name:</span> <span className="font-bold">{firstName} {lastName}</span></div>
                  <div><span className="text-ink/40">Email:</span> <span className="font-bold">{email}</span></div>
                  <div><span className="text-ink/40">City:</span> <span className="font-bold">{city}</span></div>
                  <div><span className="text-ink/40">Age:</span> <span className="font-bold">{age}</span></div>
                  <div><span className="text-ink/40">Phone:</span> <span className="font-bold">{phone ? `+91 ${phone}` : '—'}</span></div>
                </div>
              </div>

              <div className="border border-hairline bg-white p-6">
                <h3 className="text-[10px] uppercase tracking-widest text-forest font-bold mb-4">Skills & Commitment</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {skills.map(s => (
                    <span key={s} className="bg-forest/10 text-forest px-2 py-1 text-[10px] uppercase tracking-widest font-bold border border-forest/20">{s}</span>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-ink/40">Experience:</span> <span className="font-bold">{experienceYears || '—'} years</span></div>
                  <div><span className="text-ink/40">Hours/Day:</span> <span className="font-bold">{hoursPerDay || '—'}</span></div>
                  <div><span className="text-ink/40">Commitment:</span> <span className="font-bold">{COMMITMENT_LEVELS.find(c => c.value === commitmentLevel)?.label}</span></div>
                </div>
              </div>

              <div className="border border-hairline bg-white p-6">
                <h3 className="text-[10px] uppercase tracking-widest text-forest font-bold mb-4">Vision</h3>
                <p className="text-sm"><span className="text-ink/40">Has idea:</span> <span className="font-bold">{hasIdea ? 'Yes' : 'Builder Pool'}</span></p>
                {hasIdea && ideaCategory && (
                  <p className="text-sm mt-2"><span className="text-ink/40">Category:</span> <span className="font-bold">{IDEA_CATEGORIES.find(c => c.value === ideaCategory)?.label}</span></p>
                )}
                {hasIdea && ideaSummary && (
                  <p className="text-sm mt-2 text-ink/70 italic">{ideaSummary}</p>
                )}
              </div>
            </div>

            {/* Agreement Checkbox */}
            <div className={`border-2 p-6 transition-colors ${errors.agreement ? 'border-terracotta bg-terracotta/5' : agreementAccepted ? 'border-forest bg-forest/5' : 'border-hairline'}`}>
              <label className="flex items-start gap-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreementAccepted}
                  onChange={e => setAgreementAccepted(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-forest"
                />
                <div>
                  <p className="font-serif text-lg font-bold text-forest mb-2">Founding Agreement — 51% Stake Commitment</p>
                  <p className="text-sm text-ink/70 leading-relaxed">
                    I understand and agree that by joining Aryavartham&apos;s Founder&apos;s Club, the team and I commit to building with a 51% equity stake allocated to the founding team. I acknowledge that this platform serves as execution infrastructure and that my participation is bound by the terms shared during the onboarding process.
                  </p>
                </div>
              </label>
              {errors.agreement && <p className="text-terracotta text-[10px] mt-3 uppercase tracking-widest">{errors.agreement}</p>}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="pt-12 pb-24 border-t border-hairline/20 mt-12 flex justify-between items-center">
          {step > 1 ? (
            <button
              type="button"
              onClick={goPrev}
              className="text-sm font-sans uppercase tracking-widest text-ink/60 hover:text-forest transition-colors font-bold"
            >
              ← Previous
            </button>
          ) : <div />}
          
          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={goNext}
              className="bg-forest text-parchment px-12 py-5 text-sm font-sans uppercase tracking-widest hover:bg-forest/90 transition-colors active:opacity-70"
            >
              Continue →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              className="bg-forest text-parchment px-12 py-5 text-sm font-sans uppercase tracking-widest hover:bg-forest/90 transition-colors active:opacity-70"
            >
              Seal & Submit Application
            </button>
          )}
        </div>

        {/* Auto-save indicator */}
        <div className="text-center">
          <p className="text-[9px] font-sans uppercase tracking-[0.15em] text-ink/30">
            Draft auto-saved • Applications reviewed on a rolling basis
          </p>
        </div>
      </div>
    </div>
  );
}
