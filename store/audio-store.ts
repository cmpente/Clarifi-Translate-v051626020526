import { create } from 'zustand';
import { openDB } from 'idb';
import { v4 as uuidv4 } from 'uuid';

export type AppState = 'DISCONNECTED' | 'CONNECTING' | 'LISTENING_ACTIVE' | 'TRANSLATING' | 'ERROR';

export interface TranscriptItem {
  id: string;
  source: string;
  translation: string;
  isFinal: boolean;
  timestamp: number;
}

export interface Session {
  id: string;
  timestamp: number;
  transcripts: TranscriptItem[];
}

interface AudioStore {
  state: AppState;
  currentSessionId: string | null;
  transcript: TranscriptItem[];
  activeTranscript: string;
  sessions: Session[];
  volume: number;
  outputVolume: number;
  error: string | null;
  activeDeviceLabel: string | null;
  voiceName: string;
  voicePitch: number;
  voiceRate: number;
  setState: (state: AppState) => void;
  setVolume: (volume: number) => void;
  setOutputVolume: (volume: number) => void;
  setError: (error: string | null) => void;
  setActiveTranscript: (text: string) => void;
  setActiveDeviceLabel: (label: string | null) => void;
  setVoiceName: (name: string) => void;
  setVoicePitch: (pitch: number) => void;
  setVoiceRate: (rate: number) => void;
  startSession: () => void;
  updateTranscript: (id: string, source: string, translation: string, isFinal: boolean, voiceName?: string) => void;
  clearTranscript: () => void;
  loadSessions: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

const DB_NAME = 'clarifi-db';
const STORE_NAME = 'sessions';

const initDB = async () => {
  return openDB(DB_NAME, 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      }
    },
  });
};

export const useAudioStore = create<AudioStore>((set, get) => ({
  state: 'DISCONNECTED',
  currentSessionId: null,
  transcript: [],
  activeTranscript: '',
  sessions: [],
  volume: 0,
  outputVolume: 0,
  error: null,
  activeDeviceLabel: null,
  voiceName: 'Puck',
  voicePitch: 0,
  voiceRate: 1,
  setState: (state) => set({ state }),
  setVolume: (volume) => set({ volume }),
  setOutputVolume: (outputVolume) => set({ outputVolume }),
  setError: (error) => set({ error, state: error ? 'ERROR' : 'DISCONNECTED' }),
  setActiveTranscript: (activeTranscript) => set({ activeTranscript }),
  setActiveDeviceLabel: (activeDeviceLabel) => set({ activeDeviceLabel }),
  setVoiceName: (voiceName) => set({ voiceName }),
  setVoicePitch: (voicePitch) => set({ voicePitch }),
  setVoiceRate: (voiceRate) => set({ voiceRate }),
  startSession: () => {
    set({ currentSessionId: uuidv4(), transcript: [], activeTranscript: '' });
  },
  updateTranscript: async (id, source, translation, isFinal, voiceName) => {
    const timestamp = Date.now();
    const item: TranscriptItem = { id, source, translation, isFinal, timestamp };
    
    let currentSessionId = get().currentSessionId;
    if (!currentSessionId) {
      currentSessionId = uuidv4();
      set({ currentSessionId });
    }

    set((state) => {
      const existing = state.transcript.findIndex((t) => t.id === id);
      if (existing >= 0) {
        const newTranscript = [...state.transcript];
        newTranscript[existing] = item;
        return { transcript: newTranscript };
      }
      return { transcript: [...state.transcript, item] };
    });

    if (isFinal) {
      try {
        const db = await initDB();
        const session: Session = {
          id: currentSessionId,
          timestamp: Date.now(),
          transcripts: get().transcript.filter(t => t.isFinal)
        };
        
        const existingSession = await db.get(STORE_NAME, currentSessionId);
        if (existingSession) {
          session.timestamp = existingSession.timestamp;
        }
        
        await db.put(STORE_NAME, session);
        get().loadSessions();
      } catch (err) {
        console.error('Failed to save session to DB:', err);
      }
    }
  },
  clearTranscript: () => {
    set({ transcript: [], currentSessionId: null });
  },
  loadSessions: async () => {
    try {
      const db = await initDB();
      const all = await db.getAll(STORE_NAME);
      all.sort((a, b) => b.timestamp - a.timestamp);
      set({ sessions: all });
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  },
  deleteSession: async (id) => {
    try {
      const db = await initDB();
      await db.delete(STORE_NAME, id);
      get().loadSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }
}));

