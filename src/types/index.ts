/**
 * Lumino 协作服务器 - 类型定义
 * 基于 lumino-rs 项目的数据结构
 */

// ==================== 用户相关 ====================

export interface User {
  id: string;
  username: string;
  socketId: string;
  roomId: string | null;
  color: string;
  lastActive: number;
  mousePosition: MousePosition | null;
}

export interface MousePosition {
  x: number;
  y: number;
  viewState?: ViewState;
}

// ==================== 房间相关 ====================

export interface Room {
  id: string;
  inviteCode: string;
  hostId: string;
  name: string;
  createdAt: number;
  users: Map<string, User>;
  projectState: ProjectState;
  maxUsers: number;
}

// ==================== 项目状态 ====================

export interface ProjectState {
  midiData: MidiData | null;
  viewState: ViewState;
  lastModified: number;
  modifiedBy: string | null;
}

// 基于 lumino-rs/crates/ui/src/editor/state.rs
export interface ViewState {
  scroll_x: number;
  scroll_y: number;
  zoom_x: number;
  zoom_y: number;
  total_ticks: number;
  key_count: number;
  visible_key_count: number;
  ppq: number;
  keyboard_width: number;
  snap_precision: number;
  default_note_length: number;
}

// 基于 lumino-rs/crates/core/src/midi.rs
export interface MidiData {
  info: MidiInfo;
  events: MidiEvent[];
  tracks: TrackData[];
}

export interface MidiInfo {
  title: string;
  artist: string;
  bpm: number;
  timeSignature: [number, number];
  keySignature: string;
  ppq: number;
  trackCount: number;
  duration: number;
}

export interface TrackData {
  index: number;
  name: string;
  channel: number;
  notes: Note[];
  events: MidiEvent[];
}

// 基于 lumino-rs/crates/ui/src/editor/note.rs
export interface Note {
  id: string;
  tick: number;
  key: number;
  length: number;
  velocity: number;
  channel: number;
  trackIndex: number;
}

// 基于 lumino-rs/crates/core/src/midi/event.rs
export type MidiEvent =
  | { type: 'noteOn'; track: number; tick: number; channel: number; key: number; velocity: number }
  | { type: 'noteOff'; track: number; tick: number; channel: number; key: number; velocity: number }
  | { type: 'controlChange'; track: number; tick: number; channel: number; controller: number; value: number }
  | { type: 'programChange'; track: number; tick: number; channel: number; program: number }
  | { type: 'tempo'; track: number; tick: number; tempo: number }
  | { type: 'timeSignature'; track: number; tick: number; numerator: number; denominator: number }
  | { type: 'keySignature'; track: number; tick: number; key: number; isMajor: boolean }
  | { type: 'trackName'; track: number; tick: number; name: string }
  | { type: 'other'; track: number; tick: number; raw: number[] };

// ==================== 消息类型 ====================

export type ClientMessage =
  | { type: 'auth'; username: string }
  | { type: 'createRoom'; name: string }
  | { type: 'joinRoom'; inviteCode: string }
  | { type: 'leaveRoom' }
  | { type: 'mouseMove'; position: MousePosition }
  | { type: 'noteBatch'; notes: NoteBatchOperation }
  | { type: 'midiEvent'; event: MidiEvent }
  | { type: 'midiEventBatch'; events: MidiEvent[] }
  | { type: 'projectUpdate'; update: ProjectUpdate }
  | { type: 'requestSync' }
  | { type: 'ping'; timestamp: number };

export type ServerMessage =
  | { type: 'authSuccess'; userId: string; inviteCode: string }
  | { type: 'authError'; error: string }
  | { type: 'roomCreated'; room: RoomInfo }
  | { type: 'roomJoined'; room: RoomInfo; users: UserInfo[]; projectState: ProjectState }
  | { type: 'roomError'; error: string }
  | { type: 'userJoined'; user: UserInfo }
  | { type: 'userLeft'; userId: string }
  | { type: 'mouseUpdate'; userId: string; username: string; position: MousePosition; color: string }
  | { type: 'noteBatchUpdate'; userId: string; operation: NoteBatchOperation }
  | { type: 'midiEventUpdate'; userId: string; event: MidiEvent }
  | { type: 'midiEventBatchUpdate'; userId: string; events: MidiEvent[] }
  | { type: 'projectStateUpdate'; userId: string; update: ProjectUpdate }
  | { type: 'fullSync'; projectState: ProjectState; users: UserInfo[] }
  | { type: 'pong'; timestamp: number; serverTime: number }
  | { type: 'error'; error: string };

// ==================== 批量操作 ====================

export interface NoteBatchOperation {
  action: 'add' | 'update' | 'delete' | 'move' | 'copy' | 'paste';
  notes: Note[];
  sourceTrack?: number;
  targetTrack?: number;
  tickOffset?: number;
  keyOffset?: number;
  timestamp: number;
}

export interface ProjectUpdate {
  type: 'viewState' | 'track' | 'tempo' | 'timeSignature' | 'metadata' | 'full';
  data: unknown;
  timestamp: number;
}

// ==================== 简化信息 ====================

export interface RoomInfo {
  id: string;
  inviteCode: string;
  name: string;
  hostId: string;
  userCount: number;
  maxUsers: number;
}

export interface UserInfo {
  id: string;
  username: string;
  color: string;
  isHost: boolean;
}

// ==================== WebSocket ====================

import { WebSocket } from 'ws';

export interface ExtendedWebSocket extends WebSocket {
  id: string;
  userId: string | null;
  roomId: string | null;
  isAlive: boolean;
  lastPing: number;
}
