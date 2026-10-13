import React from 'react';
import { Video, RotateCcw, Home, Sparkles, CheckCircle2 } from 'lucide-react';

interface CallEndedViewProps {
  pin: string;
  durationSec: number;
  userName: string;
  onRejoin: () => void;
  onHome: () => void;
}

export const CallEndedView: React.FC<CallEndedViewProps> = ({
  pin,
  durationSec,
  userName,
  onRejoin,
  onHome,
}) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hrs}h ${remMins}m ${secs}s`;
    }
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-md w-full text-center space-y-6 shadow-2xl backdrop-blur-xl">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
          <CheckCircle2 className="w-8 h-8" />
        </div>

        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-white">Call Ended</h2>
          <p className="text-xs text-zinc-400">
            You left Room <span className="font-mono font-bold text-blue-400">#{pin}</span>
          </p>
        </div>

        {/* Stats card */}
        <div className="bg-zinc-950 rounded-2xl p-4 border border-zinc-850 grid grid-cols-2 gap-4">
          <div className="text-left">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
              Duration
            </span>
            <p className="text-base font-semibold text-zinc-200 mt-0.5">
              {formatTime(durationSec)}
            </p>
          </div>
          <div className="text-left">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
              Room PIN
            </span>
            <p className="text-base font-mono font-bold text-blue-400 mt-0.5">{pin}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3 pt-2">
          <button
            onClick={onRejoin}
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-blue-600/25 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Rejoin Room #{pin}</span>
          </button>

          <button
            onClick={onHome}
            className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-sm flex items-center justify-center gap-2 border border-zinc-750 transition cursor-pointer"
          >
            <Home className="w-4 h-4" />
            <span>Back to Home Screen</span>
          </button>
        </div>
      </div>
    </div>
  );
};
