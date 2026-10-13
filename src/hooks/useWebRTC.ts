import { useState, useEffect, useRef, useCallback } from 'react';
import { PeerInfo, ChatMessage, ReactionItem, DeviceOption } from '../types';
import { RTC_CONFIGURATION, createAudioLevelMeter } from '../utils/webrtc';

interface UseWebRTCOptions {
  pin: string;
  userName: string;
  initialAudio?: boolean;
  initialVideo?: boolean;
}

export function useWebRTC({ pin, userName, initialAudio = true, initialVideo = true }: UseWebRTCOptions) {
  const [peerId] = useState(() => 'peer_' + Math.random().toString(36).substring(2, 9));
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [audioEnabled, setAudioEnabled] = useState(initialAudio);
  const [videoEnabled, setVideoEnabled] = useState(initialVideo);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [localAudioLevel, setLocalAudioLevel] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionItem[]>([]);
  const [devices, setDevices] = useState<{
    audioInputs: DeviceOption[];
    videoInputs: DeviceOption[];
    audioOutputs: DeviceOption[];
  }>({
    audioInputs: [],
    videoInputs: [],
    audioOutputs: [],
  });
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>('');
  const [selectedVideoInput, setSelectedVideoInput] = useState<string>('');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>('');
  const [mediaError, setMediaError] = useState<string | null>(null);

  // References to maintain state across callbacks without triggering effect re-runs
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const stopAudioMeterRef = useRef<(() => void) | null>(null);
  const audioEnabledRef = useRef(audioEnabled);
  const videoEnabledRef = useRef(videoEnabled);
  const isJoinedRef = useRef(false);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  useEffect(() => {
    videoEnabledRef.current = videoEnabled;
  }, [videoEnabled]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    screenStreamRef.current = screenStream;
  }, [screenStream]);

  // Enumerate media devices
  const updateDeviceList = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const deviceInfos = await navigator.mediaDevices.enumerateDevices();
      const audioIns: DeviceOption[] = [];
      const videoIns: DeviceOption[] = [];
      const audioOuts: DeviceOption[] = [];

      deviceInfos.forEach((device, index) => {
        const label = device.label || `${device.kind} ${index + 1}`;
        if (device.kind === 'audioinput') {
          audioIns.push({ deviceId: device.deviceId, label });
        } else if (device.kind === 'videoinput') {
          videoIns.push({ deviceId: device.deviceId, label });
        } else if (device.kind === 'audiooutput') {
          audioOuts.push({ deviceId: device.deviceId, label });
        }
      });

      setDevices({
        audioInputs: audioIns,
        videoInputs: videoIns,
        audioOutputs: audioOuts,
      });

      if (audioIns.length > 0 && !selectedAudioInput) setSelectedAudioInput(audioIns[0].deviceId);
      if (videoIns.length > 0 && !selectedVideoInput) setSelectedVideoInput(videoIns[0].deviceId);
      if (audioOuts.length > 0 && !selectedAudioOutput) setSelectedAudioOutput(audioOuts[0].deviceId);
    } catch (err) {
      console.warn('Failed to enumerate devices:', err);
    }
  }, [selectedAudioInput, selectedVideoInput, selectedAudioOutput]);

  // Send signaling message via WebSocket if open, with HTTP POST fallback
  const sendSignal = useCallback(
    async (to: string, data: any) => {
      let sentViaWS = false;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(
            JSON.stringify({
              type: 'signal',
              to,
              data,
            })
          );
          sentViaWS = true;
        } catch {}
      }

      // Always also send via HTTP if WS is not confirmed open or as companion
      if (!sentViaWS) {
        try {
          await fetch('/api/room/signal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin, from: peerId, to, data }),
          });
        } catch (e) {
          console.warn('HTTP signal error:', e);
        }
      }
    },
    [pin, peerId]
  );

  // Initialize or reconfigure local stream
  const initLocalStream = useCallback(
    async (audioDevId?: string, videoDevId?: string) => {
      try {
        setMediaError(null);
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => track.stop());
        }
        if (stopAudioMeterRef.current) {
          stopAudioMeterRef.current();
          stopAudioMeterRef.current = null;
        }

        const constraints: MediaStreamConstraints = {
          audio: audioDevId ? { deviceId: { exact: audioDevId } } : true,
          video: videoDevId
            ? { deviceId: { exact: videoDevId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
          console.warn('Full audio/video getUserMedia failed, attempting audio-only:', err);
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          } catch {
            stream = new MediaStream();
            setMediaError('Camera & microphone permissions unavailable. You are connected in audio/video view-only mode.');
          }
        }

        stream.getAudioTracks().forEach((t) => {
          t.enabled = audioEnabledRef.current;
        });
        stream.getVideoTracks().forEach((t) => {
          t.enabled = videoEnabledRef.current;
        });

        setLocalStream(stream);
        localStreamRef.current = stream;

        // Start volume visualizer
        stopAudioMeterRef.current = createAudioLevelMeter(stream, (level) => {
          setLocalAudioLevel(level);
          if (level > 25 && audioEnabledRef.current) {
            setActiveSpeakerId(peerId);
          }
        });

        // If peer connections exist, replace or add tracks
        const currentStream = screenStreamRef.current || stream;
        peerConnections.current.forEach((pc) => {
          currentStream.getTracks().forEach((track) => {
            const senders = pc.getSenders();
            const sender = senders.find((s) => s.track && s.track.kind === track.kind);
            if (sender) {
              sender.replaceTrack(track);
            } else {
              pc.addTrack(track, currentStream);
            }
          });
        });

        await updateDeviceList();
        return stream;
      } catch (err: any) {
        console.error('initLocalStream fatal error:', err);
        setMediaError('Could not access microphone or camera.');
        const emptyStream = new MediaStream();
        setLocalStream(emptyStream);
        localStreamRef.current = emptyStream;
        return emptyStream;
      }
    },
    [peerId, updateDeviceList]
  );

  // Helper to create or get RTCPeerConnection
  const getOrCreatePeerConnection = useCallback(
    (remotePeerId: string): RTCPeerConnection => {
      let pc = peerConnections.current.get(remotePeerId);
      if (pc && pc.connectionState !== 'closed') {
        return pc;
      }

      pc = new RTCPeerConnection(RTC_CONFIGURATION);
      peerConnections.current.set(remotePeerId, pc);

      // Add local media tracks
      const currentStream = screenStreamRef.current || localStreamRef.current;
      if (currentStream) {
        currentStream.getTracks().forEach((track) => {
          try {
            pc!.addTrack(track, currentStream);
          } catch (e) {
            console.warn('addTrack error:', e);
          }
        });
      }

      // ICE Candidates generated locally
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(remotePeerId, { candidate: event.candidate });
        }
      };

      // Remote track received
      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(remotePeerId, stream);
          return next;
        });

        // Listen for volume for active speaker detection
        createAudioLevelMeter(stream, (volume) => {
          if (volume > 25) {
            setActiveSpeakerId(remotePeerId);
          }
        });
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[PinCall] ICE with ${remotePeerId}:`, pc!.iceConnectionState);
      };

      return pc;
    },
    [sendSignal]
  );

  // Initiate WebRTC offer to another peer
  const initiateOffer = useCallback(
    async (targetPeerId: string) => {
      try {
        const pc = getOrCreatePeerConnection(targetPeerId);
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        console.log(`[PinCall] Sent offer to ${targetPeerId}`);
        await sendSignal(targetPeerId, offer);
      } catch (err) {
        console.error(`Failed to initiate offer to ${targetPeerId}:`, err);
      }
    },
    [getOrCreatePeerConnection, sendSignal]
  );

  // Handle incoming signaling messages (offer, answer, candidate)
  const processSignalingData = useCallback(
    async (fromPeerId: string, data: any) => {
      try {
        const pc = getOrCreatePeerConnection(fromPeerId);

        if (data.type === 'offer') {
          console.log(`[PinCall] Received offer from ${fromPeerId}`);
          await pc.setRemoteDescription(new RTCSessionDescription(data));

          // Flush queued candidates
          const queued = pendingCandidates.current.get(fromPeerId) || [];
          for (const cand of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('ICE add error:', e);
            }
          }
          pendingCandidates.current.delete(fromPeerId);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log(`[PinCall] Sent answer to ${fromPeerId}`);
          await sendSignal(fromPeerId, answer);
        } else if (data.type === 'answer') {
          console.log(`[PinCall] Received answer from ${fromPeerId}`);
          await pc.setRemoteDescription(new RTCSessionDescription(data));

          // Flush queued candidates
          const queued = pendingCandidates.current.get(fromPeerId) || [];
          for (const cand of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('ICE add error:', e);
            }
          }
          pendingCandidates.current.delete(fromPeerId);
        } else if (data.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
              console.warn('Add ice candidate error:', e);
            }
          } else {
            let list = pendingCandidates.current.get(fromPeerId);
            if (!list) {
              list = [];
              pendingCandidates.current.set(fromPeerId, list);
            }
            list.push(data.candidate);
          }
        }
      } catch (err) {
        console.error(`Error processing signaling data from ${fromPeerId}:`, err);
      }
    },
    [getOrCreatePeerConnection, sendSignal]
  );

  // Incoming event router (handles both WS and HTTP events)
  const handleEvent = useCallback(
    async (msg: any) => {
      switch (msg.type) {
        case 'joined': {
          const existingPeers: PeerInfo[] = msg.peers || [];
          console.log(`[PinCall] Joined room #${pin}. Existing peers:`, existingPeers.length);
          setPeers((prev) => {
            const next = new Map(prev);
            for (const p of existingPeers) {
              next.set(p.id, p);
            }
            return next;
          });

          // Send offers to all existing peers
          for (const p of existingPeers) {
            await initiateOffer(p.id);
          }
          break;
        }

        case 'peer-joined': {
          const newPeer: PeerInfo = msg.peer;
          console.log(`[PinCall] New peer joined room #${pin}:`, newPeer.name, newPeer.id);
          setPeers((prev) => {
            const next = new Map(prev);
            next.set(newPeer.id, newPeer);
            return next;
          });

          setChatMessages((prev) => [
            ...prev,
            {
              id: 'join_' + Date.now(),
              peerId: 'system',
              userName: 'System',
              text: `${newPeer.name} joined the call`,
              timestamp: Date.now(),
              isSystem: true,
            },
          ]);
          break;
        }

        case 'signal': {
          await processSignalingData(msg.from, msg.data);
          break;
        }

        case 'peer-media-state': {
          setPeers((prev) => {
            const next = new Map(prev);
            const peer = next.get(msg.peerId);
            if (peer) {
              next.set(msg.peerId, {
                ...peer,
                audioEnabled: msg.audioEnabled ?? peer.audioEnabled,
                videoEnabled: msg.videoEnabled ?? peer.videoEnabled,
                isScreenSharing: msg.isScreenSharing ?? peer.isScreenSharing,
              });
            }
            return next;
          });
          break;
        }

        case 'chat': {
          setChatMessages((prev) => {
            if (prev.some((c) => c.id === msg.id)) return prev;
            return [...prev, msg];
          });
          break;
        }

        case 'reaction': {
          setReactions((prev) => {
            if (prev.some((r) => r.id === msg.id)) return prev;
            return [...prev, msg];
          });
          setTimeout(() => {
            setReactions((prev) => prev.filter((r) => r.id !== msg.id));
          }, 3500);
          break;
        }

        case 'peer-left': {
          const leavingId = msg.peerId;
          const pc = peerConnections.current.get(leavingId);
          if (pc) {
            pc.close();
            peerConnections.current.delete(leavingId);
          }
          let leavingName = 'Participant';
          setPeers((prev) => {
            const next = new Map(prev);
            const p = next.get(leavingId);
            if (p) leavingName = p.name;
            next.delete(leavingId);
            return next;
          });
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(leavingId);
            return next;
          });

          setChatMessages((prev) => [
            ...prev,
            {
              id: 'left_' + Date.now(),
              peerId: 'system',
              userName: 'System',
              text: `${leavingName} left the call`,
              timestamp: Date.now(),
              isSystem: true,
            },
          ]);
          break;
        }
      }
    },
    [pin, initiateOffer, processSignalingData]
  );

  // Master Connection Effect: joins room and starts signaling
  useEffect(() => {
    let isDisposed = false;

    const connect = async () => {
      // 1. Acquire local camera/mic stream
      await initLocalStream();
      if (isDisposed) return;

      setConnectionStatus('connecting');

      // 2. HTTP Join (Guarantees registration regardless of WS proxies)
      try {
        const joinRes = await fetch('/api/room/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pin,
            peerId,
            userName,
            audioEnabled: audioEnabledRef.current,
            videoEnabled: videoEnabledRef.current,
          }),
        });

        if (joinRes.ok) {
          const joinData = await joinRes.json();
          if (!isDisposed) {
            isJoinedRef.current = true;
            setConnectionStatus('connected');
            await handleEvent(joinData);
          }
        }
      } catch (err) {
        console.warn('HTTP join error:', err);
      }

      // 3. Connect WebSocket for sub-second signaling
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isDisposed) return;
          console.log('[PinCall] WebSocket connected to server');
          setConnectionStatus('connected');
          ws.send(
            JSON.stringify({
              type: 'join',
              pin,
              peerId,
              userName,
              audioEnabled: audioEnabledRef.current,
              videoEnabled: videoEnabledRef.current,
            })
          );
        };

        ws.onmessage = async (event) => {
          if (isDisposed) return;
          try {
            const msg = JSON.parse(event.data);
            await handleEvent(msg);
          } catch (e) {
            console.error('WS message error:', e);
          }
        };

        ws.onclose = () => {
          if (isDisposed) return;
          console.log('[PinCall] WebSocket closed; relying on polling fallback');
        };

        ws.onerror = (e) => {
          console.warn('[PinCall] WebSocket error:', e);
        };
      } catch (err) {
        console.warn('Failed to create WebSocket:', err);
      }

      // 4. Background Polling Loop (Active fallback that guarantees message delivery)
      pollTimerRef.current = window.setInterval(async () => {
        if (isDisposed) return;
        try {
          const res = await fetch(`/api/room/poll/${pin}/${peerId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.events && Array.isArray(data.events)) {
              for (const ev of data.events) {
                await handleEvent(ev);
              }
            }
          }
        } catch {}
      }, 1200);
    };

    connect();

    return () => {
      isDisposed = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }

      // Send leave via WS and HTTP
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'leave' }));
          wsRef.current.close();
        } catch {}
      }

      fetch('/api/room/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, peerId }),
        keepalive: true,
      }).catch(() => {});

      // Close all peer connections
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();

      // Stop media tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (stopAudioMeterRef.current) {
        stopAudioMeterRef.current();
      }
    };
  }, [pin, peerId, userName, initLocalStream, handleEvent]);

  // Audio Toggle
  const toggleAudio = useCallback(() => {
    setAudioEnabled((prev) => {
      const next = !prev;
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = next;
        });
      }

      const payload = { type: 'media-state', pin, peerId, audioEnabled: next };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
      }
      fetch('/api/room/media-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});

      return next;
    });
  }, [pin, peerId]);

  // Video Toggle
  const toggleVideo = useCallback(() => {
    setVideoEnabled((prev) => {
      const next = !prev;
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((track) => {
          track.enabled = next;
        });
      }

      const payload = { type: 'media-state', pin, peerId, videoEnabled: next };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
      }
      fetch('/api/room/media-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});

      return next;
    });
  }, [pin, peerId]);

  // Screen Share Toggle
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        setScreenStream(null);
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);

      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (videoTrack) {
        peerConnections.current.forEach((pc) => {
          const senders = pc.getSenders();
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
          if (videoSender) videoSender.replaceTrack(videoTrack);
        });
      }

      const payload = { type: 'media-state', pin, peerId, isScreenSharing: false };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
      }
      fetch('/api/room/media-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        setScreenStream(stream);
        screenStreamRef.current = stream;
        setIsScreenSharing(true);

        const screenVideoTrack = stream.getVideoTracks()[0];
        peerConnections.current.forEach((pc) => {
          const senders = pc.getSenders();
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
          if (videoSender && screenVideoTrack) {
            videoSender.replaceTrack(screenVideoTrack);
          }
        });

        screenVideoTrack.onended = () => {
          setIsScreenSharing(false);
          setScreenStream(null);
          screenStreamRef.current = null;
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) {
            peerConnections.current.forEach((pc) => {
              const senders = pc.getSenders();
              const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
              if (videoSender) videoSender.replaceTrack(camTrack);
            });
          }
          const payload = { type: 'media-state', pin, peerId, isScreenSharing: false };
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(payload));
          }
          fetch('/api/room/media-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch(() => {});
        };

        const payload = { type: 'media-state', pin, peerId, isScreenSharing: true };
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(payload));
        }
        fetch('/api/room/media-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {});
      } catch (err) {
        console.warn('Screen share failed or cancelled:', err);
      }
    }
  }, [isScreenSharing, pin, peerId]);

  // Send Chat Message
  const sendChatMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const payload = {
        type: 'chat',
        pin,
        peerId,
        userName,
        text: text.trim(),
      };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
      }
      fetch('/api/room/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    },
    [pin, peerId, userName]
  );

  // Send Reaction
  const sendReaction = useCallback(
    (emoji: string) => {
      const payload = { type: 'reaction', pin, peerId, emoji };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
      }
      fetch('/api/room/reaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});

      const localItem: ReactionItem = {
        id: 'react_local_' + Math.random().toString(36).substring(2, 9),
        peerId,
        emoji,
        timestamp: Date.now(),
      };
      setReactions((prev) => [...prev, localItem]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== localItem.id));
      }, 3500);
    },
    [pin, peerId]
  );

  const switchAudioDevice = useCallback(
    async (deviceId: string) => {
      setSelectedAudioInput(deviceId);
      await initLocalStream(deviceId, selectedVideoInput);
    },
    [initLocalStream, selectedVideoInput]
  );

  const switchVideoDevice = useCallback(
    async (deviceId: string) => {
      setSelectedVideoInput(deviceId);
      await initLocalStream(selectedAudioInput, deviceId);
    },
    [initLocalStream, selectedAudioInput]
  );

  return {
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
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    sendChatMessage,
    sendReaction,
    switchAudioDevice,
    switchVideoDevice,
    setSelectedAudioOutput,
    initLocalStream,
  };
}
