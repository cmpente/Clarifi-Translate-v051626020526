import { motion } from 'motion/react';

export function MicNoiseMeter({ volume, colorClass }: { volume: number; colorClass: string }) {
  // Map volume to a number of bars (0-12)
  const bars = Math.min(12, Math.max(0, Math.floor(volume / 8.3)));

  return (
    <div className="flex items-center gap-1 h-4">
      {[...Array(12)].map((_, i) => (
        <motion.div
          key={i}
          initial={{ height: '4px' }}
          animate={{
            height: i < bars ? '16px' : '4px',
          }}
          className={`w-1 rounded-full transition-colors duration-150 ${colorClass} ${i < bars ? 'bg-current' : 'bg-slate-700'}`}
        />
      ))}
    </div>
  );
}
