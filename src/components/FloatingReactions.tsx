import React from 'react';
import { ReactionItem } from '../types';

interface FloatingReactionsProps {
  reactions: ReactionItem[];
}

export const FloatingReactions: React.FC<FloatingReactionsProps> = ({ reactions }) => {
  return (
    <div className="pointer-events-none fixed bottom-24 right-8 w-40 h-96 overflow-hidden z-40">
      {reactions.map((r, index) => {
        // Random horizontal drift
        const leftOffset = 20 + ((r.id.charCodeAt(r.id.length - 1) * 17) % 60);
        return (
          <div
            key={r.id}
            className="absolute bottom-0 text-3xl sm:text-4xl animate-float-up transition-opacity"
            style={{
              left: `${leftOffset}%`,
              animation: 'floatUp 3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
              animationDelay: `${(index % 3) * 0.1}s`,
            }}
          >
            {r.emoji}
          </div>
        );
      })}
      <style>{`
        @keyframes floatUp {
          0% {
            opacity: 0;
            transform: translateY(0) scale(0.5);
          }
          15% {
            opacity: 1;
            transform: translateY(-40px) scale(1.2);
          }
          70% {
            opacity: 0.9;
            transform: translateY(-240px) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-320px) scale(0.8);
          }
        }
      `}</style>
    </div>
  );
};
