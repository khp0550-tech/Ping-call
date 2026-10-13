import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Monitor, Maximize2, PictureInPicture2, Volume2 } from 'lucide-react';
import { AudioVisualizer } from './AudioVisualizer';

interface VideoTileProps {
  id: string;
  name: string;
  stream: MediaStream | null;
  isLocal?: boolean;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  isScreenSharing?: boolean;
  isActiveSpeaker?: boolean;
  audioLevel?: number;
  onPin?: () => void;
  isPinned?: boolean;
}

export const VideoTile: React.FC<VideoTileProps> = ({
  id,
  name,
  stream,
  isLocal = false,
  audioEnabled = true,
  videoEnabled = true,
  isScreenSharing = false,
  isActiveSpeaker = false,
  audioLevel = 0,
  onPin,
  isPinned = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
      const vTracks = stream.getVideoTracks();
      setHasVideoTrack(vTracks.length > 0 && vTracks.some((t) => t.enabled));

      const handleTrackChange = () => {
        const tracks = stream.getVideoTracks();
        setHasVideoTrack(tracks.length > 0 && tracks.some((t) => t.enabled));
        videoRef.current?.play().catch(() => {});
      };

      stream.addEventListener('addtrack', handleTrackChange);
      stream.addEventListener('removetrack', handleTrackChange);

      return () => {
        stream.removeEventListener('addtrack', handleTrackChange);
        stream.removeEventListener('removetrack', handleTrackChange);
      };
    } else {
      setHasVideoTrack(false);
    }
  }, [stream, videoEnabled]);

  // Picture-in-picture handler
  const handlePiP = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current && document.pictureInPictureEnabled) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await videoRef.current.requestPictureInPicture();
        }
      } catch (err) {
        console.warn('PiP error:', err);
      }
    }
  };

  // Fullscreen handler
  const handleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        containerRef.current.requestFullscreen().catch(() => {});
      }
    }
  };

  // Avatar initial
  const initials = (name || 'User')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // Consistent color hash for user avatar
  const getAvatarGradient = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      'from-blue-600 to-indigo-700',
      'from-purple-600 to-pink-700',
      'from-emerald-600 to-teal-700',
      'from-amber-600 to-orange-700',
      'from-rose-600 to-red-700',
      'from-cyan-600 to-blue-700',
    ];
    return colors[Math.abs(hash) % colors.length];
  };

  const showVideo = videoEnabled && hasVideoTrack;

  return (
    <div
      ref={containerRef}
      className={`group relative w-full h-full rounded-2xl overflow-hidden bg-zinc-900 border transition-all duration-300 shadow-lg flex items-center justify-center select-none ${
        isActiveSpeaker
          ? 'border-emerald-500 ring-2 ring-emerald-500/30'
          : isPinned
          ? 'border-blue-500 ring-2 ring-blue-500/20'
          : 'border-zinc-800 hover:border-zinc-700'
      }`}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal} // Local must be muted to prevent acoustic feedback
        className={`w-full h-full ${
          isScreenSharing ? 'object-contain bg-black' : 'object-cover'
        } ${isLocal && !isScreenSharing ? '-scale-x-100' : ''} ${
          showVideo ? 'opacity-100' : 'opacity-0 absolute'
        }`}
      />

      {/* Placeholder Avatar when Video is Disabled */}
      {!showVideo && (
        <div className="flex flex-col items-center justify-center gap-3 p-4 text-center">
          <div
            className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-br ${getAvatarGradient(
              name
            )} flex items-center justify-center text-white text-2xl sm:text-3xl font-semibold shadow-inner transition-transform duration-200 group-hover:scale-105`}
          >
            {initials}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-200 text-sm font-medium">{name}</span>
            {isLocal && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                You
              </span>
            )}
          </div>
        </div>
      )}

      {/* Screen Sharing Badge Overlay */}
      {isScreenSharing && (
        <div className="absolute top-3 left-3 bg-blue-600/90 text-white backdrop-blur-md px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 shadow">
          <Monitor className="w-3.5 h-3.5" />
          <span>Presenting screen</span>
        </div>
      )}

      {/* Top right action buttons (hover overlay) */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/60 backdrop-blur-md p-1 rounded-xl">
        {onPin && (
          <button
            onClick={onPin}
            className={`p-1.5 rounded-lg text-xs transition ${
              isPinned
                ? 'bg-blue-600 text-white'
                : 'text-zinc-300 hover:text-white hover:bg-white/10'
            }`}
            title={isPinned ? 'Unpin' : 'Pin to focus'}
          >
            <span className="text-xs font-mono">📌</span>
          </button>
        )}
        <button
          onClick={handlePiP}
          className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition"
          title="Picture in Picture"
        >
          <PictureInPicture2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleFullscreen}
          className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition"
          title="Fullscreen"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bottom Info Bar */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-xs text-white max-w-[80%] truncate shadow-sm">
          <span className="truncate font-medium">
            {name} {isLocal && '(You)'}
          </span>

          {/* Audio Visualizer / Mic status */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {audioEnabled ? (
              <AudioVisualizer level={audioLevel} size="sm" />
            ) : (
              <MicOff className="w-3.5 h-3.5 text-red-400" />
            )}
          </div>
        </div>

        {/* Active speaker status tag */}
        {isActiveSpeaker && (
          <div className="bg-emerald-500/90 text-white px-2 py-1 rounded-full text-[10px] font-medium flex items-center gap-1 shadow animate-pulse">
            <Volume2 className="w-3 h-3" />
            <span>Speaking</span>
          </div>
        )}
      </div>
    </div>
  );
};
