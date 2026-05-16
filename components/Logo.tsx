'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const TRANSLATIONS = [
  { lang: 'English', text: 'TRANSLATOR' },
  { lang: 'French', text: 'TRADUCTEUR' },
  { lang: 'Haitian Creole', text: 'TRADIKTÈ' },
  { lang: 'Spanish', text: 'TRADUCTOR' },
  { lang: 'Bosnian', text: 'PREVODITELJ' },
];

export function Logo() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % TRANSLATIONS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-16 w-40 flex items-center justify-start font-bold tracking-tighter text-xl leading-tight">
      <div className="flex flex-col">
        <span className="text-slate-100 uppercase tracking-widest text-sm font-medium">CLARIFI</span>
        <div className="relative h-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={TRANSLATIONS[index].lang}
              initial={{ opacity: 0, y: 5, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -5, filter: 'blur(4px)' }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className="absolute whitespace-nowrap text-cyan-400 uppercase"
            >
              {TRANSLATIONS[index].text}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
