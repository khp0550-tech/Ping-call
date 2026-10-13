export interface PeerInfo {
  id: string;
  name: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isScreenSharing?: boolean;
  isHandRaised?: boolean;
}

export interface ChatMessage {
  id: string;
  peerId: string;
  userName: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface ReactionItem {
  id: string;
  peerId: string;
  emoji: string;
  timestamp: number;
}

export interface DeviceOption {
  deviceId: string;
  label: string;
}

export interface WebRTCStats {
  peerId: string;
  roundTripTime?: number;
  packetsLost?: number;
  videoResolution?: string;
  bitrate?: number;
}
