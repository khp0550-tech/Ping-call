import React from 'react';

interface AudioVisualizerProps {
  level: number; // 0 - 100
  isMuted?: boolean;
  size?: 'sm' | 'md';
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ level, isMuted, size = 'md' }) => {
  if (isMuted) {
    return (
      <div className="flex items-center gap-0.5 opacity-40">
        <span className="w-1 h-2 bg-red-400 rounded-full" />
        <span className="w-1 h-2 bg-red-400 rounded-full" />
        <span className="w-1 h-2 bg-red-400 rounded-full" />
      </div>
    );
  }

  // 3-bar or 4-bar equalizer
  const bars = [0.2, 0.5, 0.8, 1.0];
  const barHeight = size === 'sm' ? 12 : 16;

  return (
    <div className="flex items-end gap-0.5 h-4 px-1" title={`Audio Level: ${level}%`}>
      {bars.map((threshold, idx) => {
        const active = level > threshold * 15;
        const normalized = Math.max(3, Math.min(barHeight, Math.round((level / 100) * barHeight * (1 + idx * 0.2))));
        return (
          <span
            key={idx}
            className={`w-1 rounded-full transition-all duration-75 ${
              active ? 'bg-emerald-400' : 'bg-zinc-600'
            }`}
            style={{
              height: `${active ? normalized : 3}px`,
            }}
          />
        );
      })}
    </div>
  );
};
