import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Zap,
  Users,
  Settings2,
  RefreshCw,
  Copy,
  Check,
  QrCode,
} from 'lucide-react';
import { AudioVisualizer } from './AudioVisualizer';
import { createAudioLevelMeter } from '../utils/webrtc';
import { generateQRCodeSVG } from '../utils/qrCode';

interface LobbyViewProps {
  onJoin: (pin: string, userName: string, audioEnabled: boolean, videoEnabled: boolean) => void;
  initialPin?: string;
}

export const LobbyView: React.FC<LobbyViewProps> = ({ onJoin, initialPin = '' }) => {
  const [pinDigits, setPinDigits] = useState<string[]>(['', '', '', '']);
  const [userName, setUserName] = useState(() => localStorage.getItem('pincall_username') || '');
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [generatedPinModal, setGeneratedPinModal] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeTab, setActiveTab] = useState<'join' | 'create'>('join');

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const digitInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const stopAudioMeterRef = useRef<(() => void) | null>(null);

  // Initialize PIN from initialPin prop or URL query
  useEffect(() => {
    if (initialPin && /^\d{4}$/.test(initialPin)) {
      setPinDigits(initialPin.split(''));
    }
  }, [initialPin]);

  // Request preview camera & microphone stream for the green room
  useEffect(() => {
    let stream: MediaStream | null = null;
    let isMounted = true;

    const startPreview = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: true,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        setPreviewStream(stream);
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
        }

        // Setup audio level meter for microphone check
        stopAudioMeterRef.current = createAudioLevelMeter(stream, (vol) => {
          if (isMounted) setAudioLevel(vol);
        });
      } catch (err) {
        console.warn('Lobby preview stream permission failed:', err);
      }
    };

    startPreview();

    return () => {
      isMounted = false;
      if (stopAudioMeterRef.current) stopAudioMeterRef.current();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Update track enablements in preview
  useEffect(() => {
    if (previewStream) {
      previewStream.getAudioTracks().forEach((t) => {
        t.enabled = micEnabled;
      });
      previewStream.getVideoTracks().forEach((t) => {
        t.enabled = cameraEnabled;
      });
    }
  }, [previewStream, micEnabled, cameraEnabled]);

  // Handle individual digit input changes with auto-advance
  const handleDigitChange = (index: number, val: string) => {
    const clean = val.replace(/\D/g, '');
    if (!clean) {
      const nextDigits = [...pinDigits];
      nextDigits[index] = '';
      setPinDigits(nextDigits);
      return;
    }

    // Single character entered
    const digit = clean.slice(-1);
    const nextDigits = [...pinDigits];
    nextDigits[index] = digit;
    setPinDigits(nextDigits);

    // Auto-focus next input
    if (index < 3) {
      digitInputRefs.current[index + 1]?.focus();
    }
  };

  // Handle keyboard navigation (backspace moves back, arrow keys)
  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      digitInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      digitInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 3) {
      digitInputRefs.current[index + 1]?.focus();
    } else if (e.key === 'Enter') {
      submitJoin();
    }
  };

  // Handle pasting full 4 digits
  const handleDigitPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasted.length > 0) {
      const next = ['', '', '', ''];
      for (let i = 0; i < pasted.length; i++) {
        next[i] = pasted[i];
      }
      setPinDigits(next);
      const focusIndex = Math.min(3, pasted.length);
      digitInputRefs.current[focusIndex]?.focus();
    }
  };

  // On-screen touch keypad
  const handleKeypadPress = (val: string) => {
    if (val === 'C') {
      // Clear
      setPinDigits(['', '', '', '']);
      digitInputRefs.current[0]?.focus();
      return;
    }
    if (val === 'DEL') {
      // Find last non-empty digit
      let lastIdx = -1;
      for (let i = pinDigits.length - 1; i >= 0; i--) {
        if (pinDigits[i] !== '') {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx >= 0) {
        const next = [...pinDigits];
        next[lastIdx] = '';
        setPinDigits(next);
        digitInputRefs.current[lastIdx]?.focus();
      }
      return;
    }
    // Number pressed: find first empty spot
    const firstEmpty = pinDigits.findIndex((d) => d === '');
    if (firstEmpty !== -1) {
      const next = [...pinDigits];
      next[firstEmpty] = val;
      setPinDigits(next);
      if (firstEmpty < 3) {
        digitInputRefs.current[firstEmpty + 1]?.focus();
      }
    }
  };

  // Instant room generation
  const handleCreateInstantRoom = async () => {
    try {
      const res = await fetch('/api/room/create', { method: 'POST' });
      const data = await res.json();
      const newPin = data.pin || Math.floor(1000 + Math.random() * 9000).toString();
      setGeneratedPinModal(newPin);
      setPinDigits(newPin.split(''));
    } catch {
      const fallbackPin = Math.floor(1000 + Math.random() * 9000).toString();
      setGeneratedPinModal(fallbackPin);
      setPinDigits(fallbackPin.split(''));
    }
  };

  const currentPin = pinDigits.join('');
  const isPinComplete = currentPin.length === 4;

  const submitJoin = () => {
    if (!isPinComplete) return;
    const effectiveName = userName.trim() || `User-${Math.floor(100 + Math.random() * 900)}`;
    localStorage.setItem('pincall_username', effectiveName);
    onJoin(currentPin, effectiveName, micEnabled, cameraEnabled);
  };

  const copyShareLink = (pin: string) => {
    const url = `${window.location.origin}?pin=${pin}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/50 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Video className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
                PinCall
              </span>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                WebRTC P2P
              </span>
            </div>
            <p className="text-xs text-zinc-400">Direct peer video calls via 4-digit PIN</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-400 bg-zinc-900 px-3 py-1.5 rounded-full border border-zinc-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Signaling Online</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 flex flex-col items-center justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full items-center">
          {/* Left Column: 4-Digit PIN Interface */}
          <div className="lg:col-span-6 flex flex-col items-start space-y-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Zero hassle • No sign-up • 4-digit room code</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
                Jump into video calls with just a{' '}
                <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent">
                  4-Digit PIN
                </span>
              </h1>
              <p className="text-zinc-400 text-sm sm:text-base leading-relaxed">
                Connect instantly with friends, teammates, or clients. Enter an existing PIN or generate a new call in seconds.
              </p>
            </div>

            {/* PIN Entry Card */}
            <div className="w-full bg-zinc-900/90 border border-zinc-800 rounded-3xl p-6 shadow-2xl backdrop-blur-xl">
              {/* Tab Selector */}
              <div className="flex bg-zinc-950 p-1 rounded-2xl mb-6 border border-zinc-800/80">
                <button
                  type="button"
                  onClick={() => setActiveTab('join')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    activeTab === 'join'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Join with PIN
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('create');
                    handleCreateInstantRoom();
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === 'create'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Start New Call</span>
                </button>
              </div>

              {/* Display Name Input */}
              <div className="mb-6">
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Your Display Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Alex Rivera"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  maxLength={30}
                />
              </div>

              {/* 4-Digit PIN Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    {activeTab === 'join' ? 'Enter 4-Digit Room PIN' : 'Your Call PIN'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowKeypad(!showKeypad)}
                    className="text-xs text-blue-400 hover:text-blue-300 transition"
                  >
                    {showKeypad ? 'Hide Keypad' : 'Touch Keypad'}
                  </button>
                </div>

                {/* 4 Large Digit Input Boxes */}
                <div
                  className="flex items-center justify-between gap-3 sm:gap-4"
                  onPaste={handleDigitPaste}
                >
                  {pinDigits.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => {
                        digitInputRefs.current[index] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleDigitChange(index, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(index, e)}
                      className={`w-full aspect-square max-w-[76px] text-center text-3xl sm:text-4xl font-mono font-bold rounded-2xl bg-zinc-950 border transition-all duration-150 focus:outline-none ${
                        digit
                          ? 'border-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)] bg-blue-950/20'
                          : 'border-zinc-800 text-zinc-500 focus:border-blue-500/80 focus:bg-zinc-900'
                      }`}
                      autoFocus={index === 0 && !initialPin}
                    />
                  ))}
                </div>

                {/* Interactive Touch Keypad (collapsible) */}
                {showKeypad && (
                  <div className="grid grid-cols-3 gap-2 pt-2 bg-zinc-950/60 p-3 rounded-2xl border border-zinc-800">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'DEL'].map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleKeypadPress(key)}
                        className="py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-lg font-mono font-semibold text-zinc-200 active:scale-95 transition"
                      >
                        {key === 'DEL' ? '⌫' : key}
                      </button>
                    ))}
                  </div>
                )}

                {/* Join Call Action Button */}
                <button
                  type="button"
                  onClick={submitJoin}
                  disabled={!isPinComplete}
                  className={`w-full py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2 transition-all duration-200 shadow-xl ${
                    isPinComplete
                      ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white hover:brightness-110 shadow-indigo-500/25 cursor-pointer active:scale-[0.99]'
                      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  <span>Join Call Now</span>
                  <ArrowRight className="w-5 h-5" />
                </button>

                {/* Quick Instant Random Generator */}
                <div className="pt-2 flex items-center justify-between text-xs text-zinc-400">
                  <button
                    type="button"
                    onClick={handleCreateInstantRoom}
                    className="flex items-center gap-1.5 text-zinc-300 hover:text-white transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                    <span>Generate random 4-digit PIN</span>
                  </button>
                  {isPinComplete && (
                    <span className="text-emerald-400 flex items-center gap-1 font-mono">
                      PIN: {currentPin}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Green Room Device Preview */}
          <div className="lg:col-span-6 flex flex-col items-center">
            <div className="w-full bg-zinc-900/90 border border-zinc-800 rounded-3xl p-5 shadow-2xl backdrop-blur-xl space-y-4">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Pre-call Device Preview
                </span>
                <div className="flex items-center gap-2">
                  <AudioVisualizer level={audioLevel} isMuted={!micEnabled} size="sm" />
                  <span className="text-xs text-zinc-400">
                    {micEnabled ? `${audioLevel}% Volume` : 'Mic Muted'}
                  </span>
                </div>
              </div>

              {/* Video Preview Box */}
              <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center shadow-inner">
                <video
                  ref={videoPreviewRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover -scale-x-100 transition-opacity duration-200 ${
                    cameraEnabled ? 'opacity-100' : 'opacity-0 absolute'
                  }`}
                />

                {!cameraEnabled && (
                  <div className="flex flex-col items-center justify-center gap-2 text-zinc-500">
                    <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 text-xl font-bold">
                      {userName ? userName[0].toUpperCase() : 'U'}
                    </div>
                    <span className="text-xs text-zinc-400">Camera is off</span>
                  </div>
                )}

                {/* Overlaid media control toggles */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-lg">
                  <button
                    type="button"
                    onClick={() => setMicEnabled(!micEnabled)}
                    className={`p-2.5 rounded-full transition ${
                      micEnabled
                        ? 'bg-zinc-800 text-white hover:bg-zinc-700'
                        : 'bg-red-500 text-white hover:bg-red-600'
                    }`}
                    title={micEnabled ? 'Mute Mic' : 'Unmute Mic'}
                  >
                    {micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setCameraEnabled(!cameraEnabled)}
                    className={`p-2.5 rounded-full transition ${
                      cameraEnabled
                        ? 'bg-zinc-800 text-white hover:bg-zinc-700'
                        : 'bg-red-500 text-white hover:bg-red-600'
                    }`}
                    title={cameraEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
                  >
                    {cameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Audio meter bar */}
              <div className="bg-zinc-950 px-4 py-3 rounded-2xl border border-zinc-800/80 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${micEnabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                    {micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-200">Microphone Test</p>
                    <p className="text-[11px] text-zinc-500">
                      {micEnabled ? 'Speak to verify audio detection' : 'Microphone is currently muted'}
                    </p>
                  </div>
                </div>
                <div className="w-24 h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-75"
                    style={{ width: `${micEnabled ? audioLevel : 0}%` }}
                  />
                </div>
              </div>

              {/* Share PIN & QR Preview if generated */}
              {isPinComplete && (
                <div className="bg-blue-950/30 border border-blue-500/30 rounded-2xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-600 text-white rounded-xl font-mono font-bold text-lg">
                      {currentPin}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-blue-200">Shareable Room PIN</p>
                      <p className="text-[11px] text-zinc-400">Invite anyone with this 4-digit code</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyShareLink(currentPin)}
                    className="flex items-center gap-1.5 bg-blue-600/80 hover:bg-blue-600 text-white text-xs px-3 py-2 rounded-xl transition"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full mt-12 pt-8 border-t border-zinc-800/60">
          <div className="bg-zinc-900/40 border border-zinc-800/60 p-4 rounded-2xl flex items-start gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 flex-shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-zinc-200">4-Digit Room Codes</h4>
              <p className="text-xs text-zinc-400 mt-0.5">
                No long confusing links or meeting IDs. Just 4 simple numbers anyone can remember and type in.
              </p>
            </div>
          </div>

          <div className="bg-zinc-900/40 border border-zinc-800/60 p-4 rounded-2xl flex items-start gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 flex-shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-zinc-200">Direct WebRTC Encryption</h4>
              <p className="text-xs text-zinc-400 mt-0.5">
                Peer-to-peer media streams with DTLS/SRTP end-to-end encryption. Your audio and video never touch cloud recorders.
              </p>
            </div>
          </div>

          <div className="bg-zinc-900/40 border border-zinc-800/60 p-4 rounded-2xl flex items-start gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 flex-shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-zinc-200">Screen Share & Live Chat</h4>
              <p className="text-xs text-zinc-400 mt-0.5">
                Share slides, code, or presentations in HD, send instant chat messages, and burst emoji reactions.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/60 px-6 py-4 text-center text-xs text-zinc-500 flex flex-col sm:flex-row items-center justify-between max-w-6xl w-full mx-auto">
        <p>PinCall • Secure 4-Digit WebRTC Video Calling</p>
        <p className="text-zinc-500">Supports Chrome, Safari, Firefox, Edge & Mobile Browsers</p>
      </footer>
    </div>
  );
};
