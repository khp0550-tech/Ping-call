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
  const [isConnected, setIsConnected] = useState(false);
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

  // References to preserve state across callbacks
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const fallbackPollTimer = useRef<number | null>(null);
  const stopAudioMeterRef = useRef<(() => void) | null>(null);

  // Keep localStreamRef in sync
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  // Keep screenStreamRef in sync
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

  // Helper to send messages over WebSocket or fallback
  const sendSignalMessage = useCallback((msg: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      // HTTP fallback
      if (msg.to) {
        fetch('/api/signaling/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: msg.to, message: msg }),
        }).catch(() => {});
      }
    }
  }, []);

  // Initialize Local Media Stream
  const initLocalStream = useCallback(async (audioDevId?: string, videoDevId?: string) => {
    try {
      setMediaError(null);
      // Clean up previous stream tracks if any
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
      } catch (err: any) {
        console.warn('Could not get both audio/video, trying video-only or audio-only fallback:', err);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch {
          // If all hardware fails, create empty dummy stream to allow in-room presence
          stream = new MediaStream();
          setMediaError('Camera and microphone access was denied or unavailable. You can still join and listen/chat.');
        }
      }

      // Set initial track enablement
      stream.getAudioTracks().forEach((t) => {
        t.enabled = audioEnabled;
      });
      stream.getVideoTracks().forEach((t) => {
        t.enabled = videoEnabled;
      });

      setLocalStream(stream);
      localStreamRef.current = stream;

      // Start audio level visualizer
      stopAudioMeterRef.current = createAudioLevelMeter(stream, (level) => {
        setLocalAudioLevel(level);
        if (level > 25 && audioEnabled) {
          setActiveSpeakerId(peerId);
        }
      });

      await updateDeviceList();
      return stream;
    } catch (err: any) {
      console.error('getUserMedia error:', err);
      setMediaError(err.message || 'Failed to access camera or microphone');
      const emptyStream = new MediaStream();
      setLocalStream(emptyStream);
      localStreamRef.current = emptyStream;
      return emptyStream;
    }
  }, [audioEnabled, videoEnabled, peerId, updateDeviceList]);

  // Create RTCPeerConnection for a remote peer
  const createPeerConnection = useCallback((remotePeerId: string): RTCPeerConnection => {
    // Return existing if valid
    const existingPC = peerConnections.current.get(remotePeerId);
    if (existingPC && existingPC.connectionState !== 'closed') {
      return existingPC;
    }

    const pc = new RTCPeerConnection(RTC_CONFIGURATION);
    peerConnections.current.set(remotePeerId, pc);

    // Add local tracks to RTCPeerConnection
    const currentStream = screenStreamRef.current || localStreamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach((track) => {
        pc.addTrack(track, currentStream);
      });
    }

    // ICE Candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignalMessage({
          type: 'signal',
          to: remotePeerId,
          data: { candidate: event.candidate },
        });
      }
    };

    // Track received handler
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(remotePeerId, remoteStream);
          return next;
        });

        // Monitor remote audio for active speaker detection
        createAudioLevelMeter(remoteStream, (volume) => {
          if (volume > 25) {
            setActiveSpeakerId(remotePeerId);
          }
        });
      }
    };

    // Connection state changes
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // Handle cleanup or reconnect
      }
    };

    return pc;
  }, [sendSignalMessage]);

  // Handle incoming signaling payload
  const handleSignal = useCallback(async (fromPeerId: string, data: any) => {
    let pc = peerConnections.current.get(fromPeerId);
    if (!pc) {
      pc = createPeerConnection(fromPeerId);
    }

    if (data.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      // Flush any queued candidates
      const queued = pendingCandidates.current.get(fromPeerId) || [];
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Error adding queued ICE candidate:', e);
        }
      }
      pendingCandidates.current.delete(fromPeerId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignalMessage({
        type: 'signal',
        to: fromPeerId,
        data: answer,
      });
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      // Flush queued candidates
      const queued = pendingCandidates.current.get(fromPeerId) || [];
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Error adding queued ICE candidate:', e);
        }
      }
      pendingCandidates.current.delete(fromPeerId);
    } else if (data.candidate) {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.warn('Error adding ICE candidate:', err);
        }
      } else {
        const queued = pendingCandidates.current.get(fromPeerId) || [];
        queued.push(data.candidate);
        pendingCandidates.current.set(fromPeerId, queued);
      }
    }
  }, [createPeerConnection, sendSignalMessage]);

  // Connect to Signaling Server via WebSocket (with HTTP fallback)
  useEffect(() => {
    let isCancelled = false;
    let ws: WebSocket;

    const setupSignaling = async () => {
      // First ensure local stream is ready
      await initLocalStream();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isCancelled) return;
        setIsConnected(true);
        setConnectionStatus('connected');
        // Send join event with 4-digit PIN
        ws.send(
          JSON.stringify({
            type: 'join',
            pin,
            peerId,
            userName: userName || `Guest-${peerId.slice(0, 4)}`,
            audioEnabled,
            videoEnabled,
          })
        );
      };

      ws.onmessage = async (event) => {
        if (isCancelled) return;
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'joined': {
              // Successfully joined room
              const existingPeers: PeerInfo[] = msg.peers || [];
              const peersMap = new Map<string, PeerInfo>();

              for (const p of existingPeers) {
                peersMap.set(p.id, p);
                // We initiate the offer to existing peers
                const pc = createPeerConnection(p.id);
                try {
                  const offer = await pc.createOffer();
                  await pc.setLocalDescription(offer);
                  sendSignalMessage({
                    type: 'signal',
                    to: p.id,
                    data: offer,
                  });
                } catch (err) {
                  console.error('Error creating offer for existing peer:', err);
                }
              }
              setPeers(peersMap);

              // Add system welcome message
              setChatMessages((prev) => [
                ...prev,
                {
                  id: 'welcome_' + Date.now(),
                  peerId: 'system',
                  userName: 'PinCall Room',
                  text: `Connected to Room #${pin}. Share this 4-digit PIN with others to invite them.`,
                  timestamp: Date.now(),
                  isSystem: true,
                },
              ]);
              break;
            }

            case 'peer-joined': {
              const newPeer: PeerInfo = msg.peer;
              setPeers((prev) => {
                const next = new Map(prev);
                next.set(newPeer.id, newPeer);
                return next;
              });

              // Notification in chat
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
              await handleSignal(msg.from, msg.data);
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
              setChatMessages((prev) => [...prev, msg]);
              break;
            }

            case 'reaction': {
              setReactions((prev) => [...prev, msg]);
              // Auto-remove reaction after 4s
              setTimeout(() => {
                setReactions((prev) => prev.filter((r) => r.id !== msg.id));
              }, 4000);
              break;
            }

            case 'peer-left': {
              const leavingId = msg.peerId;
              const leavingPeer = peers.get(leavingId);
              const pc = peerConnections.current.get(leavingId);
              if (pc) {
                pc.close();
                peerConnections.current.delete(leavingId);
              }
              setPeers((prev) => {
                const next = new Map(prev);
                next.delete(leavingId);
                return next;
              });
              setRemoteStreams((prev) => {
                const next = new Map(prev);
                next.delete(leavingId);
                return next;
              });

              if (leavingPeer) {
                setChatMessages((prev) => [
                  ...prev,
                  {
                    id: 'left_' + Date.now(),
                    peerId: 'system',
                    userName: 'System',
                    text: `${leavingPeer.name} left the call`,
                    timestamp: Date.now(),
                    isSystem: true,
                  },
                ]);
              }
              break;
            }

            case 'error': {
              console.warn('Signaling error:', msg.message);
              break;
            }
          }
        } catch (err) {
          console.error('Failed to parse WS message:', err);
        }
      };

      ws.onclose = () => {
        if (isCancelled) return;
        setIsConnected(false);
        setConnectionStatus('disconnected');
        // Start polling fallback in case WS closed
        if (!fallbackPollTimer.current) {
          fallbackPollTimer.current = window.setInterval(async () => {
            try {
              const res = await fetch(`/api/signaling/poll/${peerId}`);
              if (res.ok) {
                const data = await res.json();
                if (data.messages && data.messages.length > 0) {
                  for (const m of data.messages) {
                    if (m.type === 'signal') {
                      await handleSignal(m.from, m.data);
                    }
                  }
                }
              }
            } catch {
              // Ignore polling failure
            }
          }, 1500);
        }
      };

      ws.onerror = () => {
        // Handled in onclose
      };
    };

    setupSignaling();

    return () => {
      isCancelled = true;
      if (wsRef.current) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'leave' }));
          wsRef.current.close();
        } catch {}
      }
      if (fallbackPollTimer.current) {
        clearInterval(fallbackPollTimer.current);
      }
      // Close all peer connections
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
      // Stop local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      // Stop screen share tracks
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (stopAudioMeterRef.current) {
        stopAudioMeterRef.current();
      }
    };
  }, [pin, userName, peerId, handleSignal, createPeerConnection, sendSignalMessage, initLocalStream, audioEnabled, videoEnabled]);

  // Audio Toggle
  const toggleAudio = useCallback(() => {
    setAudioEnabled((prev) => {
      const next = !prev;
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = next;
        });
      }
      sendSignalMessage({
        type: 'media-state',
        audioEnabled: next,
      });
      return next;
    });
  }, [sendSignalMessage]);

  // Video Toggle
  const toggleVideo = useCallback(() => {
    setVideoEnabled((prev) => {
      const next = !prev;
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((track) => {
          track.enabled = next;
        });
      }
      sendSignalMessage({
        type: 'media-state',
        videoEnabled: next,
      });
      return next;
    });
  }, [sendSignalMessage]);

  // Screen Share Toggle
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // Stop screen sharing and revert to camera
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
        setScreenStream(null);
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);

      // Revert video track in peer connections to local camera
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (videoTrack) {
        peerConnections.current.forEach((pc) => {
          const senders = pc.getSenders();
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(videoTrack);
          }
        });
      }

      sendSignalMessage({
        type: 'media-state',
        isScreenSharing: false,
      });
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

        // Replace track in all peer connections
        peerConnections.current.forEach((pc) => {
          const senders = pc.getSenders();
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
          if (videoSender && screenVideoTrack) {
            videoSender.replaceTrack(screenVideoTrack);
          }
        });

        // Listen for user stopping screen share via browser bar
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
          sendSignalMessage({
            type: 'media-state',
            isScreenSharing: false,
          });
        };

        sendSignalMessage({
          type: 'media-state',
          isScreenSharing: true,
        });
      } catch (err) {
        console.warn('Screen share cancelled or failed:', err);
      }
    }
  }, [isScreenSharing, sendSignalMessage]);

  // Send Chat Message
  const sendChatMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      sendSignalMessage({
        type: 'chat',
        userName,
        text: text.trim(),
      });
    },
    [sendSignalMessage, userName]
  );

  // Send Reaction
  const sendReaction = useCallback(
    (emoji: string) => {
      sendSignalMessage({
        type: 'reaction',
        emoji,
      });
      // Show locally as well
      const localItem: ReactionItem = {
        id: 'react_local_' + Math.random().toString(36).substring(2, 9),
        peerId,
        emoji,
        timestamp: Date.now(),
      };
      setReactions((prev) => [...prev, localItem]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== localItem.id));
      }, 4000);
    },
    [sendSignalMessage, peerId]
  );

  // Switch Audio Device
  const switchAudioDevice = useCallback(
    async (deviceId: string) => {
      setSelectedAudioInput(deviceId);
      await initLocalStream(deviceId, selectedVideoInput);
    },
    [initLocalStream, selectedVideoInput]
  );

  // Switch Video Device
  const switchVideoDevice = useCallback(
    async (deviceId: string) => {
      setSelectedVideoInput(deviceId);
      await initLocalStream(selectedAudioInput, deviceId);
    },
    [initLocalStream, selectedAudioInput]
  );

  return {
    peerId,
    isConnected,
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
