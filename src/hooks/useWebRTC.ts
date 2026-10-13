import { useState, useEffect, useRef, useCallback } from 'react';
import { Peer, MediaConnection, DataConnection } from 'peerjs';
import { PeerInfo, ChatMessage, ReactionItem, DeviceOption } from '../types';
import { RTC_CONFIGURATION, createAudioLevelMeter } from '../utils/webrtc';

interface UseWebRTCOptions {
  pin: string;
  userName: string;
  initialAudio?: boolean;
  initialVideo?: boolean;
}

export function useWebRTC({ pin, userName, initialAudio = true, initialVideo = true }: UseWebRTCOptions) {
  const [peerId, setPeerId] = useState<string>('');
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
  const peerInstanceRef = useRef<Peer | null>(null);
  const activeCalls = useRef<Map<string, MediaConnection>>(new Map());
  const activeDataConns = useRef<Map<string, DataConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const stopAudioMeterRef = useRef<(() => void) | null>(null);
  const mySlotRef = useRef<number>(1);
  const audioEnabledRef = useRef(audioEnabled);
  const videoEnabledRef = useRef(videoEnabled);
  const userNameRef = useRef(userName);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  useEffect(() => {
    videoEnabledRef.current = videoEnabled;
  }, [videoEnabled]);

  useEffect(() => {
    userNameRef.current = userName;
  }, [userName]);

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

  // Broadcast data payload to all connected peers
  const broadcastData = useCallback((payload: any) => {
    activeDataConns.current.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send(payload);
        } catch (e) {
          console.warn('Data send error:', e);
        }
      }
    });
  }, []);

  // Initialize Local Media Stream
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
          console.warn('Audio+Video getUserMedia failed, trying audio-only:', err);
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          } catch {
            stream = new MediaStream();
            setMediaError('Camera & microphone permissions unavailable. You are in view/listen mode.');
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

        // Monitor volume for visualizer
        stopAudioMeterRef.current = createAudioLevelMeter(stream, (level) => {
          setLocalAudioLevel(level);
          if (level > 25 && audioEnabledRef.current) {
            setActiveSpeakerId(peerId || 'self');
          }
        });

        // Replace track in existing calls if any
        const currentStream = screenStreamRef.current || stream;
        activeCalls.current.forEach((call) => {
          const senders = call.peerConnection?.getSenders() || [];
          currentStream.getTracks().forEach((track) => {
            const sender = senders.find((s) => s.track && s.track.kind === track.kind);
            if (sender) {
              sender.replaceTrack(track);
            }
          });
        });

        await updateDeviceList();
        return stream;
      } catch (err: any) {
        console.error('initLocalStream error:', err);
        setMediaError('Could not access microphone or camera.');
        const emptyStream = new MediaStream();
        setLocalStream(emptyStream);
        localStreamRef.current = emptyStream;
        return emptyStream;
      }
    },
    [peerId, updateDeviceList]
  );

  // Handle incoming data channel messages
  const handleDataMessage = useCallback(
    (senderPeerId: string, data: any) => {
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'hello': {
          setPeers((prev) => {
            const next = new Map(prev);
            next.set(senderPeerId, {
              id: senderPeerId,
              name: data.userName || `User-${senderPeerId.slice(-4)}`,
              audioEnabled: data.audioEnabled !== false,
              videoEnabled: data.videoEnabled !== false,
              isScreenSharing: !!data.isScreenSharing,
            });
            return next;
          });

          setChatMessages((prev) => [
            ...prev,
            {
              id: 'join_' + Date.now(),
              peerId: 'system',
              userName: 'System',
              text: `${data.userName || 'A participant'} joined the call`,
              timestamp: Date.now(),
              isSystem: true,
            },
          ]);
          break;
        }

        case 'media-state': {
          setPeers((prev) => {
            const next = new Map(prev);
            const peer = next.get(senderPeerId);
            if (peer) {
              next.set(senderPeerId, {
                ...peer,
                audioEnabled: data.audioEnabled ?? peer.audioEnabled,
                videoEnabled: data.videoEnabled ?? peer.videoEnabled,
                isScreenSharing: data.isScreenSharing ?? peer.isScreenSharing,
              });
            }
            return next;
          });
          break;
        }

        case 'chat': {
          setChatMessages((prev) => {
            if (prev.some((c) => c.id === data.id)) return prev;
            return [...prev, data];
          });
          break;
        }

        case 'reaction': {
          setReactions((prev) => {
            if (prev.some((r) => r.id === data.id)) return prev;
            return [...prev, data];
          });
          setTimeout(() => {
            setReactions((prev) => prev.filter((r) => r.id !== data.id));
          }, 3500);
          break;
        }
      }
    },
    []
  );

  // Setup data connection handlers
  const setupDataConnection = useCallback(
    (conn: DataConnection, targetPeerId: string) => {
      activeDataConns.current.set(targetPeerId, conn);

      conn.on('open', () => {
        console.log(`[PinCall] Data connection open with ${targetPeerId}`);
        // Send hello with our info
        conn.send({
          type: 'hello',
          userName: userNameRef.current,
          audioEnabled: audioEnabledRef.current,
          videoEnabled: videoEnabledRef.current,
          isScreenSharing: !!screenStreamRef.current,
        });
      });

      conn.on('data', (data) => {
        handleDataMessage(targetPeerId, data);
      });

      conn.on('close', () => {
        console.log(`[PinCall] Data connection closed with ${targetPeerId}`);
        activeDataConns.current.delete(targetPeerId);
      });

      conn.on('error', (err) => {
        console.warn(`[PinCall] Data conn error with ${targetPeerId}:`, err);
      });
    },
    [handleDataMessage]
  );

  // Setup media call handlers
  const setupMediaCall = useCallback(
    (call: MediaConnection, remoteId: string) => {
      activeCalls.current.set(remoteId, call);

      call.on('stream', (remoteStream) => {
        console.log(`[PinCall] Received remote stream from ${remoteId}`);
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(remoteId, remoteStream);
          return next;
        });

        // Monitor remote volume for active speaker detection
        createAudioLevelMeter(remoteStream, (volume) => {
          if (volume > 25) {
            setActiveSpeakerId(remoteId);
          }
        });
      });

      call.on('close', () => {
        console.log(`[PinCall] Call closed with ${remoteId}`);
        activeCalls.current.delete(remoteId);
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.delete(remoteId);
          return next;
        });
        setPeers((prev) => {
          const next = new Map(prev);
          const leaving = next.get(remoteId);
          if (leaving) {
            setChatMessages((p) => [
              ...p,
              {
                id: 'left_' + Date.now(),
                peerId: 'system',
                userName: 'System',
                text: `${leaving.name} left the call`,
                timestamp: Date.now(),
                isSystem: true,
              },
            ]);
          }
          next.delete(remoteId);
          return next;
        });
      });

      call.on('error', (err) => {
        console.warn(`[PinCall] Call error with ${remoteId}:`, err);
      });
    },
    []
  );

  // Master Connection Effect: 4-digit PIN slot-based WebRTC mesh
  useEffect(() => {
    let isDisposed = false;
    let peerInstance: Peer | null = null;

    const startRoomConnection = async () => {
      const stream = await initLocalStream();
      if (isDisposed) return;

      // Slot claim algorithm:
      // Room PIN 4829 -> IDs: pincall_4829_1, pincall_4829_2, ... up to 8
      let currentSlot = 1;

      const tryClaimSlot = (slot: number) => {
        if (isDisposed) return;
        mySlotRef.current = slot;
        const targetId = `pincall_${pin}_${slot}`;

        console.log(`[PinCall] Attempting to claim room slot: ${targetId}`);

        const p = new Peer(targetId, {
          config: RTC_CONFIGURATION,
          debug: 1,
        });

        p.on('open', (claimedId) => {
          if (isDisposed) {
            p.destroy();
            return;
          }
          console.log(`[PinCall] Successfully joined Room #${pin} as Slot ${slot} (${claimedId})`);
          peerInstance = p;
          peerInstanceRef.current = p;
          setPeerId(claimedId);
          setConnectionStatus('connected');

          setChatMessages((prev) => [
            ...prev,
            {
              id: 'welcome_' + Date.now(),
              peerId: 'system',
              userName: 'PinCall',
              text: `Connected to Room #${pin}. Share this 4-digit PIN to invite others!`,
              timestamp: Date.now(),
              isSystem: true,
            },
          ]);

          // Handle incoming calls (from higher slots)
          p.on('call', (incomingCall) => {
            console.log(`[PinCall] Answering incoming call from ${incomingCall.peer}`);
            const outgoingStream = screenStreamRef.current || localStreamRef.current || new MediaStream();
            incomingCall.answer(outgoingStream);
            setupMediaCall(incomingCall, incomingCall.peer);
          });

          // Handle incoming data connections (from higher slots)
          p.on('connection', (incomingConn) => {
            console.log(`[PinCall] Accepted data connection from ${incomingConn.peer}`);
            setupDataConnection(incomingConn, incomingConn.peer);
          });

          // Now connect to all existing peers in lower slots (1 .. slot - 1)
          const mediaStream = screenStreamRef.current || localStreamRef.current || stream;
          for (let lowerSlot = 1; lowerSlot < slot; lowerSlot++) {
            const lowerPeerId = `pincall_${pin}_${lowerSlot}`;
            console.log(`[PinCall] Calling lower slot peer: ${lowerPeerId}`);

            // 1. Data Connection
            const dataConn = p.connect(lowerPeerId, { reliable: true });
            setupDataConnection(dataConn, lowerPeerId);

            // 2. Media Call
            const call = p.call(lowerPeerId, mediaStream);
            setupMediaCall(call, lowerPeerId);
          }

          // Periodic check to discover any newly available lower peers or keep connections alive
          const pollTimer = setInterval(() => {
            if (isDisposed || p.destroyed) {
              clearInterval(pollTimer);
              return;
            }
            for (let lower = 1; lower < slot; lower++) {
              const target = `pincall_${pin}_${lower}`;
              if (!activeCalls.current.has(target)) {
                const s = screenStreamRef.current || localStreamRef.current || new MediaStream();
                const call = p.call(target, s);
                setupMediaCall(call, target);
                const d = p.connect(target, { reliable: true });
                setupDataConnection(d, target);
              }
            }
          }, 4000);
        });

        p.on('error', (err: any) => {
          if (err.type === 'unavailable-id') {
            console.log(`[PinCall] Slot ${slot} is occupied. Trying next slot...`);
            p.destroy();
            if (slot < 8) {
              tryClaimSlot(slot + 1);
            } else {
              // If all 8 standard slots are full, join as guest extension
              const randomGuestSlot = `pincall_${pin}_guest_${Math.floor(100 + Math.random() * 900)}`;
              const guestPeer = new Peer(randomGuestSlot, { config: RTC_CONFIGURATION });
              guestPeer.on('open', (gId) => {
                peerInstance = guestPeer;
                peerInstanceRef.current = guestPeer;
                setPeerId(gId);
                setConnectionStatus('connected');
                // Call slots 1..8
                const s = screenStreamRef.current || localStreamRef.current || stream;
                for (let i = 1; i <= 8; i++) {
                  const target = `pincall_${pin}_${i}`;
                  guestPeer.call(target, s);
                  guestPeer.connect(target, { reliable: true });
                }
              });
            }
          } else {
            console.warn('[PinCall] PeerJS error:', err.type, err.message);
          }
        });
      };

      tryClaimSlot(1);
    };

    startRoomConnection();

    return () => {
      isDisposed = true;
      if (peerInstanceRef.current) {
        try {
          peerInstanceRef.current.destroy();
        } catch {}
        peerInstanceRef.current = null;
      }
      activeCalls.current.clear();
      activeDataConns.current.clear();

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
  }, [pin, initLocalStream, setupMediaCall, setupDataConnection]);

  // Toggle Audio
  const toggleAudio = useCallback(() => {
    setAudioEnabled((prev) => {
      const next = !prev;
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((t) => {
          t.enabled = next;
        });
      }
      broadcastData({
        type: 'media-state',
        audioEnabled: next,
      });
      return next;
    });
  }, [broadcastData]);

  // Toggle Video
  const toggleVideo = useCallback(() => {
    setVideoEnabled((prev) => {
      const next = !prev;
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((t) => {
          t.enabled = next;
        });
      }
      broadcastData({
        type: 'media-state',
        videoEnabled: next,
      });
      return next;
    });
  }, [broadcastData]);

  // Toggle Screen Sharing
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        setScreenStream(null);
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);

      const camVideoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camVideoTrack) {
        activeCalls.current.forEach((call) => {
          const senders = call.peerConnection?.getSenders() || [];
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(camVideoTrack);
          }
        });
      }

      broadcastData({
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

        const screenTrack = stream.getVideoTracks()[0];
        activeCalls.current.forEach((call) => {
          const senders = call.peerConnection?.getSenders() || [];
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
          if (videoSender && screenTrack) {
            videoSender.replaceTrack(screenTrack);
          }
        });

        screenTrack.onended = () => {
          setIsScreenSharing(false);
          setScreenStream(null);
          screenStreamRef.current = null;
          const cam = localStreamRef.current?.getVideoTracks()[0];
          if (cam) {
            activeCalls.current.forEach((call) => {
              const senders = call.peerConnection?.getSenders() || [];
              const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
              if (videoSender) videoSender.replaceTrack(cam);
            });
          }
          broadcastData({
            type: 'media-state',
            isScreenSharing: false,
          });
        };

        broadcastData({
          type: 'media-state',
          isScreenSharing: true,
        });
      } catch (err) {
        console.warn('Screen share cancelled or failed:', err);
      }
    }
  }, [isScreenSharing, broadcastData]);

  // Send In-call Chat Message
  const sendChatMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const msg: ChatMessage = {
        id: 'chat_' + Math.random().toString(36).substring(2, 9),
        peerId: peerId || 'self',
        userName: userNameRef.current,
        text: text.trim(),
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, msg]);
      broadcastData(msg);
    },
    [peerId, broadcastData]
  );

  // Send Floating Emoji Reaction
  const sendReaction = useCallback(
    (emoji: string) => {
      const item: ReactionItem = {
        id: 'react_' + Math.random().toString(36).substring(2, 9),
        peerId: peerId || 'self',
        emoji,
        timestamp: Date.now(),
      };
      setReactions((prev) => [...prev, item]);
      broadcastData(item);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== item.id));
      }, 3500);
    },
    [peerId, broadcastData]
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
