// ─── Section type registry ──────────────────────────────────────────────────

export type SectionType =
  | 'hero'
  | 'how_it_works'
  | 'promise'
  | 'quote'
  | 'builder_model'
  | 'stats_bar'
  | 'philosophy'
  | 'cta'
  | 'card_carousel'
  | 'rich_text'
  | 'steps';

export interface Section {
  id: string;
  type: SectionType;
  order: number;
  visible: boolean;
  data: any;
}

export const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  hero: 'Hero',
  how_it_works: 'How It Works (Timeline + Cards)',
  promise: 'Promise Grid',
  quote: 'Pull Quote',
  builder_model: 'Builder Model (Dark Background)',
  stats_bar: 'Stats Bar',
  philosophy: 'Philosophy + Image',
  cta: 'Call to Action',
  card_carousel: 'Card Carousel (Generic)',
  rich_text: 'Rich Text Block',
  steps: 'Steps List',
};

export const SECTION_TYPE_DESCRIPTIONS: Record<SectionType, string> = {
  hero: 'Full-height opening with headline, subheadline, body and CTAs.',
  how_it_works: 'Horizontal timeline + swipeable stage cards. Add/remove steps.',
  promise: 'Left label column with 1-3 promise items on the right.',
  quote: 'Large editorial pull quote with optional attribution.',
  builder_model: 'Dark forest-green section with stat items and closing quote.',
  stats_bar: 'Horizontal row of 2–6 key numbers/stats.',
  philosophy: 'Centred verse, image, and paired text blocks.',
  cta: 'Final call-to-action with big headline and Apply button.',
  card_carousel: 'Generic swipeable card deck. Each card has media, title, description.',
  rich_text: 'Free-form text block with alignment and background control.',
  steps: 'Numbered step list with titles and descriptions.',
};

// ─── Default section data factories ─────────────────────────────────────────

export const generateSectionId = (): string =>
  `s-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

export const createDefaultData = (type: SectionType): any => {
  switch (type) {
    case 'hero':
      return {
        headline_prefix: 'Build a Startup in',
        headline_accent: '180 Days.',
        tagline: 'Innovation is the only criterion. Obsession is the only prerequisite.',
        body: "Not an accelerator. Not a network. Aryavartham pairs you with a dedicated Co-Founder, gives you 180 structured days, and the full weight of the platform — from raw idea to an operating company ready to face the market.",
        cta_primary_label: 'Apply Now',
        cta_secondary_label: 'How It Works',
        cta_secondary_anchor: 'how-it-works',
      };
    case 'how_it_works':
      return {
        title: 'How This Works',
        steps: [
          { id: generateSectionId(), step: '01', title: 'Step One', desc: 'Short description.', longDesc: 'Detailed description of step one.', mediaUrl: '', mediaType: 'image' },
          { id: generateSectionId(), step: '02', title: 'Step Two', desc: 'Short description.', longDesc: 'Detailed description of step two.', mediaUrl: '', mediaType: 'image' },
        ],
      };
    case 'promise':
      return {
        heading: 'Our Promise',
        subheading: 'A commitment that transcends traditional incubation.',
        items: [
          { id: generateSectionId(), title: 'I. First Promise', text: 'Describe the first promise here.' },
          { id: generateSectionId(), title: 'II. Second Promise', text: 'Describe the second promise here.' },
          { id: generateSectionId(), title: 'III. Third Promise', text: 'Describe the third promise here.' },
        ],
      };
    case 'quote':
      return {
        quote: 'A powerful statement that captures your philosophy.',
        attribution: '',
      };
    case 'builder_model':
      return {
        headline: 'We Build With You.',
        subheadline: 'Not For You.',
        items: [
          { id: generateSectionId(), stat: '180', label: 'Day Sprint', description: 'Description.' },
          { id: generateSectionId(), stat: '1:1', label: 'Co-Founder per Team', description: 'Description.' },
          { id: generateSectionId(), stat: '3 Yrs', label: 'Active Support', description: 'Description.' },
        ],
        closing_quote: '',
      };
    case 'stats_bar':
      return {
        items: [
          { id: generateSectionId(), value: '100', label: 'Stat Label' },
          { id: generateSectionId(), value: '200', label: 'Stat Label' },
          { id: generateSectionId(), value: '300', label: 'Stat Label' },
          { id: generateSectionId(), value: '400', label: 'Stat Label' },
        ],
      };
    case 'philosophy':
      return {
        verse: '"Your verse here"',
        imageUrl: '',
        heading: 'Section Heading',
        body: 'Describe the philosophy.',
        closing: '',
      };
    case 'cta':
      return { headline: 'Ready to Get Started?', cta_label: 'Apply Now' };
    case 'card_carousel':
      return {
        title: 'Featured Cards',
        cards: [
          { id: generateSectionId(), title: 'Card One', description: 'Card description.', mediaUrl: '', mediaType: 'image', tag: '' },
          { id: generateSectionId(), title: 'Card Two', description: 'Card description.', mediaUrl: '', mediaType: 'image', tag: '' },
        ],
      };
    case 'rich_text':
      return { content: 'Edit this text in the admin panel.', alignment: 'center', background: 'parchment' };
    case 'steps':
      return {
        title: 'Steps',
        steps: [
          { id: generateSectionId(), number: '01', title: 'First Step', description: 'Description of the first step.' },
          { id: generateSectionId(), number: '02', title: 'Second Step', description: 'Description of the second step.' },
        ],
      };
    default:
      return {};
  }
};

// ─── Default homepage sections ───────────────────────────────────────────────

export const DEFAULT_SECTIONS: Section[] = [
  {
    id: 'hero-main',
    type: 'hero',
    order: 0,
    visible: true,
    data: {
      headline_prefix: 'Build a Startup in',
      headline_accent: '180 Days.',
      tagline: 'Innovation is the only criterion. Obsession is the only prerequisite.',
      body: "Not an accelerator. Not a network. Aryavartham pairs you with a dedicated Co-Founder, gives you 180 structured days, and the full weight of the platform — from raw idea to an operating company ready to face the market.",
      cta_primary_label: 'Apply Now',
      cta_secondary_label: 'How It Works',
      cta_secondary_anchor: 'how-it-works',
    },
  },
  {
    id: 'how-it-works',
    type: 'how_it_works',
    order: 1,
    visible: true,
    data: {
      title: 'How This Works',
      steps: [
        {
          id: 'hw-s1',
          step: '01',
          title: 'Apply',
          desc: 'Submit your innovation.',
          longDesc:
            "Share your raw, unfiltered idea. We evaluate obsession, depth of insight, and the relentless drive to solve hard problems that matter for India and the world. No polished decks. No pitch competitions. Your conviction is the only credential.",
          mediaUrl: '',
          mediaType: 'image',
        },
        {
          id: 'hw-s2',
          step: '02',
          title: 'Team Formation',
          desc: 'Find your co-builders.',
          longDesc:
            "The platform auto-groups selected innovators by idea category. You'll be placed with minds who share your domain — teams of 5 to 25. A dedicated Mentor is assigned immediately. If your approach diverges within the group, you may request a separation, subject to mentor approval.",
          mediaUrl: '',
          mediaType: 'image',
        },
        {
          id: 'hw-s3',
          step: '03',
          title: 'Finalization',
          desc: 'Lock in. Receive your Co-Founder.',
          longDesc:
            "Team membership locks permanently. An Aryavartham Co-Founder — a platform staff member — is assigned to build alongside you. They hold actual co-founder responsibilities: sourcing resources, removing blockers, reporting weekly. They are accountable for your success.",
          mediaUrl: '',
          mediaType: 'image',
        },
        {
          id: 'hw-s4',
          step: '04',
          title: 'Build (90 Days)',
          desc: 'Hardcore MVP execution.',
          longDesc:
            "Ninety days. Zero distractions. Pure product development — tracked milestone by milestone on the platform. Every blocker is logged. Every week is accounted for. Your entire journey is professionally documented in a cinematic format for investor review.",
          mediaUrl: '',
          mediaType: 'image',
        },
        {
          id: 'hw-s5',
          step: '05',
          title: 'Pitch & Launch',
          desc: 'Investors. Capital. Market.',
          longDesc:
            "Your 90-day journey is produced as a documentary — shown to curated investors before the live pitch. They already know your culture, your team, your conviction. Funded teams immediately enter 90 days of go-to-market, with the full platform behind them for three years.",
          mediaUrl: '',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    id: 'promise-main',
    type: 'promise',
    order: 2,
    visible: true,
    data: {
      heading: 'We Promise',
      subheading: 'A three-year co-builder commitment that transcends traditional incubation.',
      items: [
        {
          id: 'pr-1',
          title: 'I. India-First Innovation',
          text: "India produced the world's most sophisticated trade networks and systems of value long before Western capitalism arrived. We rebuild from that foundation — not from borrowed frameworks. Every company we incubate carries that weight.",
        },
        {
          id: 'pr-2',
          title: 'II. Real Co-Founders, Not Advisors',
          text: "Every selected team receives a dedicated Aryavartham Co-Founder — a platform staff member embedded in your team with actual co-founder responsibilities. They source resources, clear blockers, and report weekly. Accountable for your progress at every stage.",
        },
        {
          id: 'pr-3',
          title: 'III. Zero-Tolerance for Theatre',
          text: "No vanity metrics. No networking mixers. No ecosystem performance. The Founder's Club exists for one purpose: to produce operating, profitable, independent Indian companies. Everything else is noise.",
        },
      ],
    },
  },
  {
    id: 'quote-main',
    type: 'quote',
    order: 3,
    visible: true,
    data: {
      quote:
        'The most dangerous founders are not the ones with the best ideas — they are the ones with the relentless will to execute against all odds.',
      attribution: '',
    },
  },
  {
    id: 'stats-bar',
    type: 'stats_bar',
    order: 4,
    visible: true,
    data: {
      items: [
        { id: 'st-1', value: '100', label: 'Founders per Cohort' },
        { id: 'st-2', value: '180', label: 'Days to Launch' },
        { id: 'st-3', value: '3', label: 'Years Platform Support' },
        { id: 'st-4', value: '90', label: 'Day MVP Sprint' },
      ],
    },
  },
  {
    id: 'builder-model',
    type: 'builder_model',
    order: 5,
    visible: true,
    data: {
      headline: 'We Build With You.',
      subheadline: 'Not For You.',
      items: [
        {
          id: 'bm-1',
          stat: '180',
          label: 'Day Sprint',
          description:
            'A structured six-month programme: 90 days of MVP development followed by 90 days of go-to-market execution. No filler.',
        },
        {
          id: 'bm-2',
          stat: '1:1',
          label: 'Co-Founder per Team',
          description:
            'Every finalized team gets one dedicated Aryavartham Co-Founder embedded with them — not a mentor on a call, a real builder in the room with accountability for your progress.',
        },
        {
          id: 'bm-3',
          stat: '3 Yrs',
          label: 'Active Support',
          description:
            'Every funded company receives three years of continued platform support — mentorship, resources, market connections, and strategic guidance as they scale.',
        },
      ],
      closing_quote: "Great companies are built in the trenches — not in boardrooms.",
    },
  },
  {
    id: 'philosophy-main',
    type: 'philosophy',
    order: 6,
    visible: true,
    data: {
      verse: '"Yatra Naryasthu Pujyanthe,\nRamante Tatra Devatha"',
      imageUrl: '/women_leadership.png',
      heading: 'We believe in empowering women leaders.',
      body: "The most transformative companies India has ever seen will be built by people who were told to wait their turn. The Founder's Club has no waiting list for ambition.",
      closing: 'We build with respect, equality, and strength.',
    },
  },
  {
    id: 'cta-final',
    type: 'cta',
    order: 7,
    visible: true,
    data: {
      headline: "Ready to Build India's Next Big Company?",
      cta_label: 'Apply Now',
    },
  },
];
