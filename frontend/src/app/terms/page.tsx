"use client";

import Layout from "@/components/Layout";
import Link from "next/link";

export default function TermsPage() {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto py-20 px-6 md:px-12 animate-fade-in text-ink">
        <header className="mb-16 border-b border-hairline pb-8">
          <h1 className="font-serif text-5xl font-bold mb-4">Terms and Conditions</h1>
          <p className="text-sm uppercase tracking-widest text-ink/60">
            Last updated March 31, 2026
          </p>
        </header>

        <section className="space-y-12 font-sans text-base leading-relaxed">
          <div className="prose prose-forest max-w-none">
            <h2 className="font-serif text-3xl font-bold mb-6 text-forest">AGREEMENT TO OUR LEGAL TERMS</h2>
            <p className="mb-4">
              We are <strong>SKSC MYSILLYDREAMS PRIVATE LIMITED</strong>, doing business as <strong>Aryavaratham</strong> ("Company," "we," "us," or "our"), a company registered in India at KPHB, Hyderabad, Telangana 500085.
            </p>
            <p className="mb-4">
              We operate the website <a href="https://aryavartham.com" className="text-forest underline italic">https://aryavartham.com</a> (the "Site"), as well as any other related products and services that refer or link to these legal terms (the "Legal Terms") (collectively, the "Services").
            </p>
            <p className="mb-4">
              You can contact us by phone at 8520857988, email at <a href="mailto:support@aryavartham.com" className="text-forest underline italic">support@aryavartham.com</a>, or by mail to KPHB, Hyderabad, Telangana 500085, India.
            </p>
            <p className="mb-4">
              These Legal Terms constitute a legally binding agreement made between you, whether personally or on behalf of an entity ("you"), and SKSC MYSILLYDREAMS PRIVATE LIMITED, concerning your access to and use of the Services. You agree that by accessing the Services, you have read, understood, and agreed to be bound by all of these Legal Terms. IF YOU DO NOT AGREE WITH ALL OF THESE LEGAL TERMS, THEN YOU ARE EXPRESSLY PROHIBITED FROM USING THE SERVICES AND YOU MUST DISCONTINUE USE IMMEDIATELY.
            </p>
            <p className="mb-4 italic text-ink/70">
              The Services are intended for users who are at least 13 years of age. All users who are minors in the jurisdiction in which they reside (generally under the age of 18) must have the permission of, and be directly supervised by, their parent or guardian to use the Services. If you are a minor, you must have your parent or guardian read and agree to these Legal Terms prior to you using the Services.
            </p>
          </div>

          <div className="bg-alabaster border border-hairline p-8">
            <h2 className="font-serif text-2xl font-bold mb-6 text-forest">TABLE OF CONTENTS</h2>
            <nav className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm uppercase tracking-widest">
              <a href="#services" className="hover:text-terracotta transition-colors">1. OUR SERVICES</a>
              <a href="#ip" className="hover:text-terracotta transition-colors">2. INTELLECTUAL PROPERTY RIGHTS</a>
              <a href="#userreps" className="hover:text-terracotta transition-colors">3. USER REPRESENTATIONS</a>
              <a href="#userreg" className="hover:text-terracotta transition-colors">4. USER REGISTRATION</a>
              <a href="#purchases" className="hover:text-terracotta transition-colors">5. PURCHASES AND PAYMENT</a>
              <a href="#refund" className="hover:text-terracotta transition-colors">6. REFUND POLICY</a>
              <a href="#prohibited" className="hover:text-terracotta transition-colors">7. PROHIBITED ACTIVITIES</a>
              <a href="#ugc" className="hover:text-terracotta transition-colors">8. USER GENERATED CONTRIBUTIONS</a>
              <a href="#license" className="hover:text-terracotta transition-colors">9. CONTRIBUTION LICENCE</a>
              <a href="#sitemanage" className="hover:text-terracotta transition-colors">10. SERVICES MANAGEMENT</a>
              <Link href="/privacy" className="hover:text-terracotta transition-colors">11. PRIVACY POLICY</Link>
              <a href="#copyright" className="hover:text-terracotta transition-colors">12. COPYRIGHT INFRINGEMENTS</a>
              <a href="#termination" className="hover:text-terracotta transition-colors">13. TERM AND TERMINATION</a>
              <a href="#modifications" className="hover:text-terracotta transition-colors">14. MODIFICATIONS AND INTERRUPTIONS</a>
              <a href="#law" className="hover:text-terracotta transition-colors">15. GOVERNING LAW</a>
              <a href="#disputes" className="hover:text-terracotta transition-colors">16. DISPUTE RESOLUTION</a>
              <a href="#corrections" className="hover:text-terracotta transition-colors">17. CORRECTIONS</a>
              <a href="#disclaimer" className="hover:text-terracotta transition-colors">18. DISCLAIMER</a>
              <a href="#liability" className="hover:text-terracotta transition-colors">19. LIMITATIONS OF LIABILITY</a>
              <a href="#indemnification" className="hover:text-terracotta transition-colors">20. INDEMNIFICATION</a>
              <a href="#userdata" className="hover:text-terracotta transition-colors">21. USER DATA</a>
              <a href="#electronic" className="hover:text-terracotta transition-colors">22. ELECTRONIC COMMUNICATIONS</a>
              <a href="#misc" className="hover:text-terracotta transition-colors">23. MISCELLANEOUS</a>
              <a href="#contact" className="hover:text-terracotta transition-colors">24. CONTACT US</a>
            </nav>
          </div>

          <article id="services" className="scroll-mt-24">
            <h3 className="font-serif text-2xl font-bold mb-4 text-forest border-l-4 border-forest pl-4">1. OUR SERVICES</h3>
            <p>
              The information provided when using the Services is not intended for distribution to or use by any person or entity in any jurisdiction or country where such distribution or use would be contrary to law or regulation or which would subject us to any registration requirement within such jurisdiction or country.
            </p>
          </article>

          <article id="ip" className="scroll-mt-24">
            <h3 className="font-serif text-2xl font-bold mb-4 text-forest border-l-4 border-forest pl-4">2. INTELLECTUAL PROPERTY RIGHTS</h3>
            <div className="space-y-4">
              <h4 className="font-bold uppercase tracking-widest text-xs opacity-60">Our intellectual property</h4>
              <p>
                We are the owner or the licensee of all intellectual property rights in our Services, including all source code, databases, functionality, software, website designs, audio, video, text, photographs, and graphics in the Services (collectively, the "Content"), as well as the trademarks, service marks, and logos contained therein (the "Marks").
              </p>
              <h4 className="font-bold uppercase tracking-widest text-xs opacity-60">Your use of our Services</h4>
              <p>
                Subject to your compliance with these Legal Terms, we grant you a non-exclusive, non-transferable, revocable licence to access the Services and download or print a copy of any portion of the Content to which you have properly gained access, solely for your personal, non-commercial use.
              </p>
            </div>
          </article>

          <article id="userreps" className="scroll-mt-24">
            <h3 className="font-serif text-2xl font-bold mb-4 text-forest border-l-4 border-forest pl-4">3. USER REPRESENTATIONS</h3>
            <p>
              By using the Services, you represent and warrant that all registration information you submit will be true, accurate, current, and complete; you will maintain the accuracy of such information; you have the legal capacity and you agree to comply with these Legal Terms; you are not under the age of 13; you will not access the Services through automated or non-human means; and your use of the Services will not violate any applicable law or regulation.
            </p>
          </article>

          <article id="purchases" className="scroll-mt-24">
            <h3 className="font-serif text-2xl font-bold mb-4 text-forest border-l-4 border-forest pl-4">5. PURCHASES AND PAYMENT</h3>
            <p className="mb-4">
              We accept the following forms of payment: Visa, Mastercard, American Express, UPI, and Netbanking. All payments shall be in INR.
            </p>
            <p>
              You agree to provide current, complete, and accurate purchase and account information for all purchases made via the Services. Sales tax will be added to the price of purchases as deemed required by us. We may change prices at any time.
            </p>
          </article>

          <article id="refund" className="scroll-mt-24">
            <h3 className="font-serif text-2xl font-bold mb-4 text-forest border-l-4 border-forest pl-4">6. REFUND POLICY</h3>
            <p className="p-6 bg-terracotta/5 border border-terracotta/10 text-terracotta font-bold">
              All sales are final and no refund will be issued.
            </p>
          </article>

          <article id="prohibited" className="scroll-mt-24">
            <h3 className="font-serif text-2xl font-bold mb-4 text-forest border-l-4 border-forest pl-4">7. PROHIBITED ACTIVITIES</h3>
            <p className="mb-4">
              You may not access or use the Services for any purpose other than that for which we make the Services available. Prohibited activities include:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-sm opacity-80">
              <li>Systematically retrieving data to create a collection or database.</li>
              <li>Tricking, defrauding, or misleading us and other users.</li>
              <li>Circumventing, disabling, or interfering with security-related features.</li>
              <li>Disparaging, tarnishing, or otherwise harming us and/or the Services.</li>
              <li>Harassing, abusing, or harming another person.</li>
              <li>Making improper use of our support services or false reports.</li>
            </ul>
          </article>

          <article id="law" className="scroll-mt-24">
            <h3 className="font-serif text-2xl font-bold mb-4 text-forest border-l-4 border-forest pl-4">15. GOVERNING LAW</h3>
            <p>
              These Legal Terms shall be governed by and defined following the laws of India. SKSC MYSILLYDREAMS PRIVATE LIMITED and yourself irrevocably consent that the courts of India shall have exclusive jurisdiction to resolve any dispute.
            </p>
          </article>

          <article id="disputes" className="scroll-mt-24">
            <h3 className="font-serif text-2xl font-bold mb-4 text-forest border-l-4 border-forest pl-4">16. DISPUTE RESOLUTION</h3>
            <div className="space-y-4">
              <h4 className="font-bold uppercase tracking-widest text-xs opacity-60">Binding Arbitration</h4>
              <p>
                Any dispute arising out of or in connection with these Legal Terms shall be referred to and finally resolved by the International Commercial Arbitration Court. The number of arbitrators shall be three (3). The seat of arbitration shall be Hyderabad, India. The language of the proceedings shall be English or Telugu.
              </p>
            </div>
          </article>

          <article id="contact" className="scroll-mt-24">
            <h3 className="font-serif text-2xl font-bold mb-4 text-forest border-l-4 border-forest pl-4">24. CONTACT US</h3>
            <p className="mb-4">
              In order to resolve a complaint regarding the Services or to receive further information regarding use of the Services, please contact us at:
            </p>
            <address className="not-italic bg-alabaster p-6 border border-hairline font-bold">
              SKSC MYSILLYDREAMS PRIVATE LIMITED<br />
              KPHB, Hyderabad<br />
              Telangana 500085<br />
              India<br />
              Phone: 8520857988<br />
              Email: support@aryavartham.com
            </address>
          </article>
        </section>

        <footer className="mt-20 pt-8 border-t border-hairline text-center">
          <p className="text-xs text-ink/40 uppercase tracking-widest">
            © {new Date().getFullYear()} Aryavartham. All rights reserved.
          </p>
        </footer>
      </div>
    </Layout>
  );
}
