import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneOff,
  MessageSquare,
  Users,
  Smile,
  Settings,
  Share2,
  Copy,
  Check,
  QrCode,
  Send,
  ExternalLink,
  Shield,
  Wifi,
  Sparkles,
  X,
  Volume2,
  SwitchCamera,
} from 'lucide-react';
import { useWebRTC } from '../hooks/useWebRTC';
import { VideoTile } from './VideoTile';
import { FloatingReactions } from './FloatingReactions';
import { generateQRCodeSVG } from '../utils/qrCode';

interface CallViewProps {
  pin: string;
  userName: string;
  initialAudio?: boolean;
  initialVideo?: boolean;
  onLeave: (durationSec: number) => void;
}

export const CallView: React.FC<CallViewProps> = ({
  pin,
  userName,
  initialAudio = true,
  initialVideo = true,
  onLeave,
}) => {
  const {
    peerId,
    connectionStatus,
    localStream,
    screenStream,
    peers,
    remoteStreams,
    audioEnabled,
    videoEnabled,
    isScreenSharing,
    activeSpeakerId,
    localAudioLevel,
    chatMessages,
    reactions,
    devices,
    selectedAudioInput,
    selectedVideoInput,
    selectedAudioOutput,
    mediaError,
    facingMode,
    isMobile,
    flipCamera,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    sendChatMessage,
    sendReaction,
    switchAudioDevice,
    switchVideoDevice,
    setSelectedAudioOutput,
  } = useWebRTC({ pin, userName, initialAudio, initialVideo });

  // UI state
  const [activeDrawer, setActiveDrawer] = useState<'chat' | 'participants' | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedPin, setCopiedPin] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // Call timer
  const [callDuration, setCallDuration] = useState(0);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Timer ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Format call duration MM:SS or HH:MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hrs.toString().padStart(2, '0')}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Keyboard shortcuts (M for mute, V for camera)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in chat input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        toggleAudio();
      } else if (e.key === 'v' || e.key === 'V') {
        toggleVideo();
      } else if (e.key === 'c' || e.key === 'C') {
        setActiveDrawer((prev) => (prev === 'chat' ? null : 'chat'));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleAudio, toggleVideo]);

  // Track unread chat messages when drawer is closed
  const prevChatCount = useRef(chatMessages.length);
  useEffect(() => {
    if (chatMessages.length > prevChatCount.current) {
      if (activeDrawer !== 'chat') {
        setUnreadChatCount((prev) => prev + (chatMessages.length - prevChatCount.current));
      }
    }
    prevChatCount.current = chatMessages.length;
    // Auto-scroll chat
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, activeDrawer]);

  const handleOpenChat = () => {
    setActiveDrawer((prev) => (prev === 'chat' ? null : 'chat'));
    setUnreadChatCount(0);
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;
    sendChatMessage(chatInput.trim());
    setChatInput('');
  };

  const copyInviteLink = async () => {
    const url = `${window.location.origin}?pin=${pin}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join Video Call on PinCall',
          text: `Join my private WebRTC call with 4-digit PIN: ${pin}`,
          url,
        });
        return;
      } catch {}
    }
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const copyPinOnly = () => {
    navigator.clipboard.writeText(pin);
    setCopiedPin(true);
    setTimeout(() => setCopiedPin(false), 2500);
  };

  const openSecondTab = () => {
    const url = `${window.location.origin}?pin=${pin}`;
    window.open(url, '_blank');
  };

  // Participant array
  const peerList = Array.from(peers.values());
  const totalParticipants = peerList.length + 1; // +1 for self

  // Check if anyone is sharing screen
  const remoteScreenSharer = peerList.find((p) => p.isScreenSharing);
  const activeScreenShare = isScreenSharing || !!remoteScreenSharer;

  // Reaction emojis
  const REACTION_EMOJIS = ['❤️', '👏', '🔥', '👍', '🎉', '😂', '✋', '💡'];

  return (
    <div className="relative w-screen h-screen dvh-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden select-none">
      {/* Top Header */}
      <header className="h-16 border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          {/* Room PIN Badge */}
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 hover:border-blue-500/50 px-3.5 py-1.5 rounded-full transition shadow-sm group cursor-pointer"
            title="Click to view invite details & QR code"
          >
            <span className="text-zinc-400 text-xs font-medium">PIN</span>
            <span className="font-mono font-bold text-sm tracking-wider text-blue-400 group-hover:text-blue-300">
              {pin}
            </span>
            <Share2 className="w-3.5 h-3.5 text-zinc-400 group-hover:text-blue-400 transition" />
          </button>

          {/* Call Timer */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-zinc-400 bg-zinc-900/80 border border-zinc-800 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{formatTime(callDuration)}</span>
          </div>
        </div>

        {/* Center / Security Indicator */}
        <div className="flex items-center gap-2 text-xs bg-zinc-900 px-3 py-1.5 rounded-full border border-zinc-800">
          <span
            className={`w-2 h-2 rounded-full ${
              connectionStatus === 'connected'
                ? 'bg-emerald-500'
                : connectionStatus === 'connecting'
                ? 'bg-amber-400 animate-ping'
                : 'bg-red-500'
            }`}
          />
          <span className="text-zinc-300 font-medium">
            {connectionStatus === 'connected'
              ? totalParticipants > 1
                ? `${totalParticipants} connected`
                : 'Ready • Waiting for others'
              : 'Connecting to room...'}
          </span>
        </div>

        {/* Right Header Quick Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={copyInviteLink}
            className="hidden sm:flex items-center gap-1.5 text-xs bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/30 px-3 py-1.5 rounded-full transition cursor-pointer"
            title="Copy invite link to share"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Link Copied!' : 'Copy Link'}</span>
          </button>

          <button
            onClick={openSecondTab}
            className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-full border border-zinc-700 transition cursor-pointer"
            title="Open second window to test peer connection"
          >
            <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden xs:inline">Test 2nd Tab</span>
          </button>

          <button
            onClick={() => setShowInviteModal(true)}
            className="p-2 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 transition"
            title="Room details and QR code"
          >
            <QrCode className="w-4 h-4 text-zinc-300" />
          </button>
        </div>
      </header>

      {/* Media Error Alert if any */}
      {mediaError && (
        <div className="bg-amber-950/80 border-b border-amber-800/60 px-4 py-2 text-xs text-amber-200 flex items-center justify-between z-20">
          <span>{mediaError}</span>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="underline ml-2 hover:text-white"
          >
            Check device permissions
          </button>
        </div>
      )}

      {/* Main Video Call Area + Drawers */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Video Canvas Stage */}
        <main className="flex-1 p-3 sm:p-4 md:p-6 flex flex-col justify-center items-center overflow-y-auto">
          {/* If ONLY local user is in the room */}
          {peerList.length === 0 ? (
            <div className="w-full max-w-4xl flex flex-col md:flex-row gap-6 items-center justify-center my-auto">
              {/* Local Video Tile */}
              <div className="w-full md:w-1/2 aspect-video max-h-[380px]">
                <VideoTile
                  id={peerId}
                  name={userName}
                  stream={isScreenSharing && screenStream ? screenStream : localStream}
                  isLocal={true}
                  audioEnabled={audioEnabled}
                  videoEnabled={videoEnabled}
                  isScreenSharing={isScreenSharing}
                  isActiveSpeaker={activeSpeakerId === peerId}
                  audioLevel={localAudioLevel}
                  facingMode={facingMode}
                />
              </div>

              {/* Waiting for peers invite banner */}
              <div className="w-full md:w-1/2 bg-zinc-900/80 border border-zinc-800 rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center space-y-5 shadow-2xl backdrop-blur-md">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                  <Sparkles className="w-7 h-7" />
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-white">Waiting for others to join</h3>
                  <p className="text-xs sm:text-sm text-zinc-400">
                    Share your 4-digit PIN or direct link with friends or coworkers.
                  </p>
                </div>

                {/* Big 4-Digit Display */}
                <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-4 w-full flex items-center justify-between">
                  <div className="text-left">
                    <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                      Room PIN
                    </span>
                    <div className="text-3xl font-mono font-extrabold tracking-widest text-blue-400">
                      {pin}
                    </div>
                  </div>
                  <button
                    onClick={copyPinOnly}
                    className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs px-3 py-2 rounded-xl border border-zinc-700 transition"
                  >
                    {copiedPin ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedPin ? 'Copied' : 'Copy PIN'}</span>
                  </button>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3 w-full">
                  <button
                    onClick={copyInviteLink}
                    className="py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-blue-600/20"
                  >
                    {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                  </button>
                  <button
                    onClick={openSecondTab}
                    className="py-3 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs flex items-center justify-center gap-2 border border-zinc-700 transition"
                  >
                    <ExternalLink className="w-4 h-4 text-blue-400" />
                    <span>Open in 2nd Tab</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Multi-party Video Grid */
            <div
              className={`w-full h-full max-w-7xl max-h-[85vh] grid gap-3 sm:gap-4 transition-all duration-300 ${
                totalParticipants === 2
                  ? 'grid-cols-1 md:grid-cols-2'
                  : totalParticipants <= 4
                  ? 'grid-cols-1 sm:grid-cols-2'
                  : 'grid-cols-2 md:grid-cols-3'
              }`}
            >
              {/* Local Participant */}
              <div className="w-full h-full min-h-[200px] flex items-center justify-center">
                <VideoTile
                  id={peerId}
                  name={userName}
                  stream={isScreenSharing && screenStream ? screenStream : localStream}
                  isLocal={true}
                  audioEnabled={audioEnabled}
                  videoEnabled={videoEnabled}
                  isScreenSharing={isScreenSharing}
                  isActiveSpeaker={activeSpeakerId === peerId}
                  audioLevel={localAudioLevel}
                  isPinned={pinnedPeerId === peerId}
                  onPin={() => setPinnedPeerId(pinnedPeerId === peerId ? null : peerId)}
                  facingMode={facingMode}
                />
              </div>

              {/* Remote Participants */}
              {peerList.map((peer) => {
                const stream = remoteStreams.get(peer.id) || null;
                return (
                  <div
                    key={peer.id}
                    className="w-full h-full min-h-[200px] flex items-center justify-center"
                  >
                    <VideoTile
                      id={peer.id}
                      name={peer.name}
                      stream={stream}
                      isLocal={false}
                      audioEnabled={peer.audioEnabled}
                      videoEnabled={peer.videoEnabled}
                      isScreenSharing={peer.isScreenSharing}
                      isActiveSpeaker={activeSpeakerId === peer.id}
                      isPinned={pinnedPeerId === peer.id}
                      onPin={() => setPinnedPeerId(pinnedPeerId === peer.id ? null : peer.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* Chat Drawer */}
        {activeDrawer === 'chat' && (
          <aside className="fixed inset-x-0 bottom-0 top-16 sm:relative sm:inset-auto sm:top-0 w-full sm:w-96 border-t sm:border-t-0 sm:border-l border-zinc-800 bg-zinc-900/98 backdrop-blur-2xl flex flex-col h-auto sm:h-full z-40 shadow-2xl transition-all">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                <h3 className="font-semibold text-sm text-white">In-Call Chat</h3>
              </div>
              <button
                onClick={() => setActiveDrawer(null)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Chat Messages List */}
            <div
              ref={chatScrollRef}
              className="flex-1 p-4 overflow-y-auto space-y-3 text-xs leading-relaxed"
            >
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 py-8">
                  <MessageSquare className="w-8 h-8 mb-2 opacity-40" />
                  <p>No messages yet.</p>
                  <p className="text-[11px] text-zinc-600">Send a message to everyone in Room #{pin}</p>
                </div>
              ) : (
                chatMessages.map((msg) => {
                  if (msg.isSystem) {
                    return (
                      <div
                        key={msg.id}
                        className="py-1 px-3 bg-zinc-800/60 rounded-xl text-center text-[11px] text-zinc-400 border border-zinc-750"
                      >
                        {msg.text}
                      </div>
                    );
                  }
                  const isMe = msg.peerId === peerId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 text-[11px] text-zinc-400">
                        <span className="font-semibold">{msg.userName}</span>
                        <span className="text-[10px] text-zinc-500">
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div
                        className={`p-3 rounded-2xl max-w-[85%] break-words ${
                          isMe
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : 'bg-zinc-800 text-zinc-100 rounded-bl-none border border-zinc-700/60'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-zinc-800 flex gap-2">
              <input
                type="text"
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                maxLength={400}
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className={`p-2.5 rounded-xl transition ${
                  chatInput.trim()
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </aside>
        )}

        {/* Participants Drawer */}
        {activeDrawer === 'participants' && (
          <aside className="fixed inset-x-0 bottom-0 top-16 sm:relative sm:inset-auto sm:top-0 w-full sm:w-96 border-t sm:border-t-0 sm:border-l border-zinc-800 bg-zinc-900/98 backdrop-blur-2xl flex flex-col h-auto sm:h-full z-40 shadow-2xl transition-all">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" />
                <h3 className="font-semibold text-sm text-white">
                  Participants ({totalParticipants})
                </h3>
              </div>
              <button
                onClick={() => setActiveDrawer(null)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-2">
              {/* Self */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-zinc-800/50 border border-zinc-800">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
                    {userName[0]?.toUpperCase() || 'Y'}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">
                      {userName} <span className="text-zinc-400 font-normal">(You)</span>
                    </p>
                    <p className="text-[10px] text-zinc-500">Local connection</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-zinc-400">
                  {audioEnabled ? (
                    <Mic className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <MicOff className="w-3.5 h-3.5 text-red-400" />
                  )}
                  {videoEnabled ? (
                    <Video className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <VideoOff className="w-3.5 h-3.5 text-red-400" />
                  )}
                </div>
              </div>

              {/* Peers */}
              {peerList.map((peer) => (
                <div
                  key={peer.id}
                  className="flex items-center justify-between p-3 rounded-2xl bg-zinc-950/40 border border-zinc-850 hover:border-zinc-800 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold text-white">
                      {peer.name[0]?.toUpperCase() || 'P'}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">{peer.name}</p>
                      <p className="text-[10px] text-emerald-400">Connected</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    {peer.audioEnabled ? (
                      <Mic className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <MicOff className="w-3.5 h-3.5 text-red-400" />
                    )}
                    {peer.videoEnabled ? (
                      <Video className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <VideoOff className="w-3.5 h-3.5 text-red-400" />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-zinc-800">
              <button
                onClick={() => setShowInviteModal(true)}
                className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white flex items-center justify-center gap-2 transition"
              >
                <Share2 className="w-4 h-4 text-blue-400" />
                <span>Invite more with PIN {pin}</span>
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Floating Reactions Animator */}
      <FloatingReactions reactions={reactions} />

      {/* Floating Call Bottom Toolbar */}
      <footer className="h-20 bg-zinc-950/90 border-t border-zinc-800/80 px-2 sm:px-4 flex items-center justify-center z-20 pb-[env(safe-area-inset-bottom,0px)]">
        <div className="flex items-center gap-1.5 sm:gap-3 bg-zinc-900/95 border border-zinc-800/90 backdrop-blur-xl px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full shadow-2xl max-w-full">
          {/* Audio Mute/Unmute */}
          <button
            onClick={toggleAudio}
            className={`p-2.5 sm:p-3 rounded-full transition-all duration-150 flex items-center justify-center ${
              audioEnabled
                ? 'bg-zinc-800 text-white hover:bg-zinc-700 active:scale-95'
                : 'bg-red-500 text-white hover:bg-red-600 shadow-md shadow-red-500/20 active:scale-95'
            }`}
            title={audioEnabled ? 'Mute Microphone (M)' : 'Unmute Microphone (M)'}
          >
            {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          {/* Video On/Off */}
          <button
            onClick={toggleVideo}
            className={`p-2.5 sm:p-3 rounded-full transition-all duration-150 flex items-center justify-center ${
              videoEnabled
                ? 'bg-zinc-800 text-white hover:bg-zinc-700 active:scale-95'
                : 'bg-red-500 text-white hover:bg-red-600 shadow-md shadow-red-500/20 active:scale-95'
            }`}
            title={videoEnabled ? 'Turn Off Camera (V)' : 'Turn On Camera (V)'}
          >
            {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          {/* Mobile Flip Camera */}
          <button
            onClick={flipCamera}
            disabled={!videoEnabled}
            className={`p-2.5 sm:p-3 rounded-full transition-all duration-150 flex items-center justify-center ${
              videoEnabled
                ? 'bg-zinc-800 text-white hover:bg-zinc-700 active:scale-95'
                : 'bg-zinc-850 text-zinc-500 cursor-not-allowed'
            }`}
            title="Flip Camera (Front / Rear)"
          >
            <SwitchCamera className="w-5 h-5" />
          </button>

          {/* Screen Share (Desktop / Tablet) */}
          <button
            onClick={toggleScreenShare}
            className={`hidden sm:flex p-3 rounded-full transition-all duration-150 items-center justify-center ${
              isScreenSharing
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/20 active:scale-95'
                : 'bg-zinc-800 text-white hover:bg-zinc-700 active:scale-95'
            }`}
            title={isScreenSharing ? 'Stop Screen Sharing' : 'Share Screen'}
          >
            <Monitor className="w-5 h-5" />
          </button>

          {/* Reactions Picker */}
          <div className="relative">
            <button
              onClick={() => setShowReactionPicker(!showReactionPicker)}
              className={`p-3 rounded-full transition-all duration-150 flex items-center justify-center ${
                showReactionPicker
                  ? 'bg-zinc-700 text-yellow-400'
                  : 'bg-zinc-800 text-white hover:bg-zinc-700'
              }`}
              title="React with emojis"
            >
              <Smile className="w-5 h-5" />
            </button>

            {/* Reaction popup */}
            {showReactionPicker && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700/80 rounded-2xl p-2 flex items-center gap-1.5 shadow-2xl backdrop-blur-md z-50">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      sendReaction(emoji);
                      setShowReactionPicker(false);
                    }}
                    className="p-2 hover:bg-zinc-800 rounded-xl text-xl hover:scale-125 transition-transform"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Chat Toggle with unread badge */}
          <button
            onClick={handleOpenChat}
            className={`relative p-3 rounded-full transition-all duration-150 flex items-center justify-center ${
              activeDrawer === 'chat'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-white hover:bg-zinc-700'
            }`}
            title="Chat"
          >
            <MessageSquare className="w-5 h-5" />
            {unreadChatCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-zinc-950 animate-bounce">
                {unreadChatCount}
              </span>
            )}
          </button>

          {/* Participants Toggle */}
          <button
            onClick={() =>
              setActiveDrawer((prev) => (prev === 'participants' ? null : 'participants'))
            }
            className={`p-3 rounded-full transition-all duration-150 flex items-center justify-center ${
              activeDrawer === 'participants'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-white hover:bg-zinc-700'
            }`}
            title="Participants"
          >
            <Users className="w-5 h-5" />
          </button>

          {/* Settings Modal Toggle */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="p-3 rounded-full bg-zinc-800 text-white hover:bg-zinc-700 transition"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

          {/* End Call / Leave */}
          <button
            onClick={() => onLeave(callDuration)}
            className="p-3 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/30 transition-transform active:scale-95 ml-1"
            title="Leave Call"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </footer>

      {/* Invite Modal (4-Digit PIN & QR Code) */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl relative space-y-5 animate-in fade-in duration-200">
            <button
              onClick={() => setShowInviteModal(false)}
              className="absolute top-5 right-5 p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Share2 className="w-5 h-5 text-blue-400" />
                <span>Invite to Video Call</span>
              </h3>
              <p className="text-xs text-zinc-400">
                Anyone with this 4-digit PIN can join you instantly.
              </p>
            </div>

            {/* Huge 4-Digit Display */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 text-center space-y-2">
              <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">
                Room 4-Digit PIN
              </span>
              <div className="flex items-center justify-center gap-3">
                {pin.split('').map((digit, idx) => (
                  <div
                    key={idx}
                    className="w-12 h-14 rounded-xl bg-blue-950/30 border border-blue-500/40 text-blue-400 text-3xl font-mono font-extrabold flex items-center justify-center shadow-inner"
                  >
                    {digit}
                  </div>
                ))}
              </div>
              <button
                onClick={copyPinOnly}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 flex items-center justify-center gap-1 mx-auto"
              >
                {copiedPin ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedPin ? 'PIN Copied!' : 'Copy 4-Digit PIN'}</span>
              </button>
            </div>

            {/* QR Code for Mobile Scanning */}
            <div className="flex flex-col items-center justify-center p-4 bg-zinc-950/60 rounded-2xl border border-zinc-800">
              <p className="text-xs text-zinc-400 mb-3 flex items-center gap-1.5 font-medium">
                <QrCode className="w-4 h-4 text-blue-400" />
                <span>Scan with your phone to join:</span>
              </p>
              <img
                src={generateQRCodeSVG(`${window.location.origin}?pin=${pin}`, 180)}
                alt={`QR code for PIN ${pin}`}
                className="w-36 h-36 rounded-xl bg-white p-2 shadow-md"
              />
            </div>

            {/* Direct Link Share & Test in 2nd Tab */}
            <div className="space-y-2">
              <button
                onClick={copyInviteLink}
                className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition shadow-md shadow-blue-600/20 active:scale-[0.99]"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                <span>{copiedLink ? 'Link Copied!' : 'Share Call Link'}</span>
              </button>
              <button
                onClick={openSecondTab}
                className="hidden sm:flex w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-xs items-center justify-center gap-2 transition"
              >
                <ExternalLink className="w-4 h-4 text-blue-400" />
                <span>Open in Second Window to Test Call</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal (Devices & Preferences) */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl relative space-y-5 animate-in fade-in duration-200">
            <button
              onClick={() => setShowSettingsModal(false)}
              className="absolute top-5 right-5 p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-400" />
                <span>Audio & Video Settings</span>
              </h3>
              <p className="text-xs text-zinc-400">Configure your hardware inputs and outputs.</p>
            </div>

            {/* Microphone Selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-blue-400" />
                <span>Microphone</span>
              </label>
              <select
                value={selectedAudioInput}
                onChange={(e) => switchAudioDevice(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                {devices.audioInputs.length === 0 ? (
                  <option value="">Default Microphone</option>
                ) : (
                  devices.audioInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Camera Selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-blue-400" />
                <span>Camera</span>
              </label>
              <select
                value={selectedVideoInput}
                onChange={(e) => switchVideoDevice(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                {devices.videoInputs.length === 0 ? (
                  <option value="">Default Camera</option>
                ) : (
                  devices.videoInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Audio Output Selector if supported */}
            {devices.audioOutputs.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Speaker Output</span>
                </label>
                <select
                  value={selectedAudioOutput}
                  onChange={(e) => setSelectedAudioOutput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {devices.audioOutputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={() => setShowSettingsModal(false)}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
