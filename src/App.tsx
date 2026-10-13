/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { LobbyView } from './components/LobbyView';
import { CallView } from './components/CallView';
import { CallEndedView } from './components/CallEndedView';

export default function App() {
  const [view, setView] = useState<'lobby' | 'in-call' | 'call-ended'>('lobby');
  const [activePin, setActivePin] = useState('');
  const [activeUserName, setActiveUserName] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [lastCallDuration, setLastCallDuration] = useState(0);

  // Check URL query on mount for ?pin=XXXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pinParam = params.get('pin');
    if (pinParam && /^\d{4}$/.test(pinParam)) {
      setActivePin(pinParam);
    }
  }, []);

  const handleJoinCall = (
    pin: string,
    userName: string,
    initialAudio: boolean,
    initialVideo: boolean
  ) => {
    setActivePin(pin);
    setActiveUserName(userName);
    setAudioEnabled(initialAudio);
    setVideoEnabled(initialVideo);

    // Update browser URL query without reloading
    const newUrl = `${window.location.pathname}?pin=${pin}`;
    window.history.pushState({ pin }, '', newUrl);

    setView('in-call');
  };

  const handleLeaveCall = (durationSec: number) => {
    setLastCallDuration(durationSec);
    setView('call-ended');

    // Clean URL query
    window.history.pushState({}, '', window.location.pathname);
  };

  const handleRejoin = () => {
    if (activePin) {
      setView('in-call');
      const newUrl = `${window.location.pathname}?pin=${activePin}`;
      window.history.pushState({ pin: activePin }, '', newUrl);
    } else {
      setView('lobby');
    }
  };

  const handleReturnHome = () => {
    setActivePin('');
    window.history.pushState({}, '', window.location.pathname);
    setView('lobby');
  };

  return (
    <div className="w-full min-h-screen bg-zinc-950 font-sans text-zinc-100 antialiased">
      {view === 'lobby' && (
        <LobbyView onJoin={handleJoinCall} initialPin={activePin} />
      )}

      {view === 'in-call' && (
        <CallView
          pin={activePin}
          userName={activeUserName}
          initialAudio={audioEnabled}
          initialVideo={videoEnabled}
          onLeave={handleLeaveCall}
        />
      )}

      {view === 'call-ended' && (
        <CallEndedView
          pin={activePin}
          durationSec={lastCallDuration}
          userName={activeUserName}
          onRejoin={handleRejoin}
          onHome={handleReturnHome}
        />
      )}
    </div>
  );
}
