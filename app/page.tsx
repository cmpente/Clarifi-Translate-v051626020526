'use client';

import Image from 'next/image';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useAudioStore } from '@/store/audio-store';
import { useAudioTranslation } from '@/hooks/use-audio-translation';
import { Mic, MicOff, Settings, Download, AlertCircle, Loader2, History as HistoryIcon, Trash2, ChevronRight, ChevronLeft, ChevronDown, X, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import dynamic from 'next/dynamic';
import { Logo } from '@/components/Logo';
import { MicNoiseMeter } from '@/components/MicNoiseMeter';

const PersonaAvatar = dynamic(() => import('@/components/PersonaAvatar'), { ssr: false });

const VOICES = [
  { name: 'Puck', officialName: 'Puck', description: 'Energetic and youthful voice.', previewText: 'Hello! I am ready to help you today.' },
  { name: 'Charon', officialName: 'Charon', description: 'Mature and thoughtful voice.', previewText: 'In the vast expanse of time, we find our answers.' },
  { name: 'Kore', officialName: 'Kore', description: 'Clear and engaging voice.', previewText: 'We are so happy to have you with us.' },
  { name: 'Fenrir', officialName: 'Fenrir', description: 'Confident and articulate voice.', previewText: 'The evidence clearly points to a different conclusion.' },
  { name: 'Zephyr', officialName: 'Zephyr', description: 'Bright and enthusiastic voice.', previewText: 'Wow, this is going to be so much fun!' }
];

function SessionCard({ session, deleteSession }: { session: any, deleteSession: any }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(session.timestamp).toLocaleString();
  
  const exportSession = () => {
    const text = session.transcripts.map((t: any) => `[${t.source || 'Unknown'}] -> ${t.translation || t.source}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${new Date(session.timestamp).toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
      <div 
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-900/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <p className="font-medium text-slate-200">{date}</p>
          <p className="text-sm text-slate-500">{session.transcripts.length} entries</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={(e) => { e.stopPropagation(); exportSession(); }} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-200" title="Export">
            <Download className="w-4 h-4" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }} className="p-2 hover:bg-red-900/30 rounded-full text-slate-400 hover:text-red-400" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
        </div>
      </div>
      {expanded && (
        <div className="p-4 border-t border-slate-800 bg-slate-900/30 space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
          {session.transcripts.map((t: any, i: number) => (
            <div key={i} className="text-sm">
              {t.source && t.translation && <div className="text-slate-500 italic mb-1">{t.source}</div>}
              <div className="text-slate-300">{t.translation || t.source}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <HomeContent />
  );
}

function HomeContent() {
  const { state, transcript, activeTranscript, sessions, volume, outputVolume, error, clearTranscript, loadSessions, deleteSession, activeDeviceLabel, voiceName, voicePitch, voiceRate, setVoiceName, setVoicePitch, setVoiceRate } = useAudioStore();
  const { startRecording, stopRecording } = useAudioTranslation();
  
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewAudioCtxRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPreviewedVoiceRef = useRef<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const formatDeviceLabel = (label: string) => {
    if (!label) return null;
    return label.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const debouncedPreview = (voice: string) => {
    if (voice === lastPreviewedVoiceRef.current && isPreviewing) return;
    
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    
    const delay = lastPreviewedVoiceRef.current === null ? 0 : 200;
    
    previewTimeoutRef.current = setTimeout(() => {
      handlePreviewVoice(voice);
    }, delay);
  };

  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const playAudio = useCallback((base64Audio: string) => {
    if (!audioContextRef.current) {
        return;
    }
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
        ctx.resume();
    }
    
    const binaryString = window.atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const pcm16 = new Int16Array(bytes.buffer);
    let dataOffset = 0;
    if (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70) {
      dataOffset = 22;
    }
    
    const audioLength = pcm16.length - dataOffset;
    const audioBuffer = ctx.createBuffer(1, audioLength, 24000);
    const channelData = audioBuffer.getChannelData(0);
    
    for (let i = 0; i < audioLength; i++) {
      channelData[i] = pcm16[i + dataOffset] / 32768.0;
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = voiceRate;
    source.detune.value = voicePitch;
    source.connect(ctx.destination);
    
    const startTime = Math.max(ctx.currentTime, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + audioBuffer.duration;
  }, [voiceRate, voicePitch]);

  const latestPreviewIdRef = useRef<number>(0);

  const handlePreviewVoice = useCallback(async (overrideVoiceName?: string) => {
    console.log("handlePreviewVoice called for:", overrideVoiceName || voiceName);
    const targetVoice = overrideVoiceName || voiceName;
    const previewId = ++latestPreviewIdRef.current;
    
    // Cleanup previous context/session
    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
    }
    
    if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
    }
    
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    nextStartTimeRef.current = audioContextRef.current.currentTime;
    
    setIsPreviewing(true);
    lastPreviewedVoiceRef.current = targetVoice;

    try {
      console.log('Connecting directly to Gemini Live API for preview...');
      const ai = new GoogleGenAI({ 
        apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || ''
      });
      
      const targetVoiceObj = VOICES.find(v => v.name === targetVoice);
      if (!targetVoiceObj) {
          console.error("handlePreviewVoice: voice not found:", targetVoice);
          setIsPreviewing(false);
          return;
      }
      
      const officialName = targetVoiceObj.officialName;
      
      const prompts = [
        `Introduce yourself warmly to the user. Keep it to one short, inviting sentence.`,
        `Say a quick, friendly hello to the user. Just one short sentence.`,
        `Give a very brief, friendly greeting to the user. Keep it under 10 words.`,
        `Say hi and let the user know you're ready to help translate. One short sentence.`,
      ];
      const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];

      // Use Live API
      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        callbacks: {
          onmessage: async (message: LiveServerMessage) => {
            // Check if this session is still the latest
            if (previewId !== latestPreviewIdRef.current) return;
            
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              playAudio(base64Audio);
            }
          },
          onclose: () => {
             if (previewId === latestPreviewIdRef.current) {
                setIsPreviewing(false);
             }
          },
          onerror: (err) => console.error("Live API error:", err)
        },
        config: {
          systemInstruction: `You are ${targetVoice}, a helpful, inviting, and friendly AI voice persona for a translation app. Greet the user warmly in English. Keep your response to exactly one short sentence. Show off your unique personality. Do not offer to translate anything yet, just say hello.`,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: officialName } },
          },
        },
      });

      // Check if another preview started while connecting
      if (previewId !== latestPreviewIdRef.current) {
        session.close();
        return;
      }

      sessionRef.current = session;

      // Send text using sendRealtimeInput
      if (typeof session.sendRealtimeInput === 'function') {
        session.sendRealtimeInput({ text: randomPrompt });
      } else {
        console.error("handlePreviewVoice: sendRealtimeInput method not found");
      }
      
    } catch (err) {
      console.error('Preview failed:', err);
      if (previewId === latestPreviewIdRef.current) {
        setIsPreviewing(false);
      }
    }
  }, [voiceName, playAudio]);

  useEffect(() => {
    loadSessions();
    navigator.mediaDevices.enumerateDevices().then((devs) => {
      const audioInputs = devs.filter((d) => d.kind === 'audioinput');
      setDevices(audioInputs);
      if (audioInputs.length > 0) {
        setSelectedDevice(audioInputs[0].deviceId);
      }
    });
  }, [loadSessions]);

  // Auto-scroll to bottom of transcript - MUST NOT BE SMOOTH
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView(); 
    }
  }, [transcript, activeTranscript]);

  const handleToggleRecording = () => {
    if (state === 'DISCONNECTED' || state === 'ERROR') {
      startRecording(selectedDevice);
    } else {
      stopRecording();
    }
  };

  const exportTranscript = () => {
    const text = transcript.map(t => `[${t.source || 'Unknown'}] -> ${t.translation || t.source}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-current-${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="flex items-center justify-between p-6 border-b border-slate-800/50 bg-slate-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Logo />
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowHistory(true)}
            className="p-3 rounded-full hover:bg-slate-800 transition-colors"
            title="History"
          >
            <HistoryIcon className="w-5 h-5 text-slate-400" />
          </button>
          <button 
            onClick={exportTranscript}
            className="p-3 rounded-full hover:bg-slate-800 transition-colors"
            title="Export Transcript"
          >
            <Download className="w-5 h-5 text-slate-400" />
          </button>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="p-3 rounded-full hover:bg-slate-800 transition-colors"
            title="Settings"
          >
            <Settings className="w-5 h-5 text-slate-400" />
          </button>
        </div>
      </header>

      {/* History Modal */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full max-w-md bg-slate-900 h-full border-l border-slate-800 flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 backdrop-blur-md sticky top-0 z-10">
                <h2 className="text-xl font-semibold">Saved Transcripts</h2>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {sessions.length === 0 ? (
                  <p className="text-slate-500 text-center mt-10">No saved transcripts yet.</p>
                ) : (
                  sessions.map(session => (
                    <SessionCard key={session.id} session={session} deleteSession={deleteSession} />
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-slate-900 border-b border-slate-800"
          >
            <div className="p-6 max-w-3xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Audio Input Device</h2>
                    <MicNoiseMeter volume={volume} colorClass="text-sky-500" />
                  </div>
                  
                  <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                    {devices.length === 0 ? (
                      <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-slate-500 text-center italic">
                        No audio input devices found.
                      </div>
                    ) : (
                      devices.map(d => (
                        <button
                          key={d.deviceId}
                          onClick={() => setSelectedDevice(d.deviceId)}
                          className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${
                            selectedDevice === d.deviceId 
                              ? 'border-sky-500 bg-sky-500/10 text-sky-50' 
                              : 'border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-900 hover:border-slate-700'
                          }`}
                        >
                          <span className="font-medium truncate pr-4">
                            {formatDeviceLabel(d.label) || `Microphone ${d.deviceId.slice(0, 5)}...`}
                          </span>
                          <div className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                            selectedDevice === d.deviceId ? 'border-sky-500' : 'border-slate-700'
                          }`}>
                            {selectedDevice === d.deviceId && (
                              <motion.div 
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="w-3 h-3 bg-sky-500 rounded-full" 
                              />
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Voice Output Settings</h2>
                    <button 
                      onClick={() => handlePreviewVoice()}
                      disabled={isPreviewing}
                      className="flex items-center gap-2 px-3 py-1.5 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isPreviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      Preview
                    </button>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-medium text-slate-300">Voice Persona</label>
                    <div className="relative flex items-center justify-center w-full h-80 overflow-hidden select-none rounded-3xl bg-slate-900/20 border border-white/5 backdrop-blur-xl shadow-2xl">
                      
                      {/* Cards */}
                      {VOICES.map((voice, index) => {
                        const currentIndex = VOICES.findIndex(v => v.name === voiceName);
                        let relPos = index - currentIndex;
                        if (relPos > Math.floor(VOICES.length / 2)) relPos -= VOICES.length;
                        if (relPos < -Math.floor(VOICES.length / 2)) relPos += VOICES.length;
                        
                        const isVisible = Math.abs(relPos) <= 2;
                        const isCurrent = relPos === 0;

                        if (!isVisible) return null;

                        return (
                          <motion.div
                            key={voice.name}
                            initial={false}
                            animate={{
                              x: relPos * 140,
                              scale: isCurrent ? 1 : 1 - Math.abs(relPos) * 0.15,
                              opacity: isCurrent ? 1 : 1 - Math.abs(relPos) * 0.4,
                              zIndex: 10 - Math.abs(relPos),
                            }}
                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                            className={`absolute w-48 h-64 rounded-2xl overflow-hidden border ${isCurrent ? 'border-sky-400/50 shadow-[0_0_30px_rgba(14,165,233,0.3)]' : 'border-white/10 shadow-lg'} bg-slate-900/60 backdrop-blur-md flex flex-col cursor-pointer`}
                            onClick={() => {
                              if (relPos === -1) {
                                const prev = VOICES[(currentIndex - 1 + VOICES.length) % VOICES.length].name;
                                setVoiceName(prev);
                                debouncedPreview(prev);
                              }
                              if (relPos === 1) {
                                const next = VOICES[(currentIndex + 1) % VOICES.length].name;
                                setVoiceName(next);
                                debouncedPreview(next);
                              }
                            }}
                          >
                            {/* WebGL Avatar */}
                            {isCurrent && (
                              <div className="absolute inset-0 z-0 opacity-80">
                                <PersonaAvatar voiceName={voice.name} energy={isPreviewing ? 1 : 0} />
                              </div>
                            )}
                            
                            {/* Content */}
                            <div className="relative z-10 flex flex-col items-center justify-start flex-1 p-4 text-center bg-gradient-to-b from-slate-900/80 via-transparent to-slate-900/80">
                              <h3 className={`font-bold transition-all duration-300 ${isCurrent ? 'text-xl text-white drop-shadow-md' : 'text-base text-slate-500'}`}>
                                {voice.name}
                              </h3>
                              {isCurrent && (
                                <motion.div 
                                  initial={{ opacity: 0, y: 5 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="mt-auto mb-2"
                                >
                                  <p className="text-[10px] text-slate-300 line-clamp-3 leading-relaxed px-2 drop-shadow-md bg-slate-900/40 rounded-lg p-1">
                                    {voice.description}
                                  </p>
                                </motion.div>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}

                      {/* Drag Overlay */}
                      <motion.div
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={1}
                        onDragEnd={(e, { offset, velocity }) => {
                          const currentIndex = VOICES.findIndex(v => v.name === voiceName);
                          if (offset.x < -50 || velocity.x < -500) {
                            const next = VOICES[(currentIndex + 1) % VOICES.length].name;
                            setVoiceName(next);
                            debouncedPreview(next);
                          } else if (offset.x > 50 || velocity.x > 500) {
                            const prev = VOICES[(currentIndex - 1 + VOICES.length) % VOICES.length].name;
                            setVoiceName(prev);
                            debouncedPreview(prev);
                          }
                        }}
                        className="absolute inset-0 z-20 cursor-grab active:cursor-grabbing"
                      />

                      {/* Navigation Buttons */}
                      <button 
                        onClick={() => {
                          const currentIndex = VOICES.findIndex(v => v.name === voiceName);
                          const prev = VOICES[(currentIndex - 1 + VOICES.length) % VOICES.length].name;
                          setVoiceName(prev);
                          debouncedPreview(prev);
                        }}
                        className="absolute left-2 z-30 p-2 bg-slate-900/50 backdrop-blur-md rounded-full border border-white/10 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => {
                          const currentIndex = VOICES.findIndex(v => v.name === voiceName);
                          const next = VOICES[(currentIndex + 1) % VOICES.length].name;
                          setVoiceName(next);
                          debouncedPreview(next);
                        }}
                        className="absolute right-2 z-30 p-2 bg-slate-900/50 backdrop-blur-md rounded-full border border-white/10 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-300">Pitch</label>
                      <span className="text-xs text-slate-500 font-mono">{voicePitch > 0 ? '+' : ''}{voicePitch} cents</span>
                    </div>
                    <input 
                      type="range" 
                      min="-1200" 
                      max="1200" 
                      step="100"
                      value={voicePitch}
                      onChange={(e) => setVoicePitch(parseInt(e.target.value))}
                      className="w-full accent-sky-500"
                    />
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Lower</span>
                      <span>Default</span>
                      <span>Higher</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-300">Speaking Rate</label>
                      <span className="text-xs text-slate-500 font-mono">{voiceRate.toFixed(1)}x</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.5" 
                      max="2.0" 
                      step="0.1"
                      value={voiceRate}
                      onChange={(e) => setVoiceRate(parseFloat(e.target.value))}
                      className="w-full accent-sky-500"
                    />
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Slower</span>
                      <span>Normal</span>
                      <span>Faster</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <p className="mt-6 text-xs text-slate-500 text-center italic">
                Changes will take effect the next time you start recording.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col p-6 max-w-3xl mx-auto w-full gap-8">
        
        {/* Status & Visualizer */}
        <div className="flex flex-col items-center justify-center py-12 gap-8">
          <div className="relative w-64 h-64 flex items-center justify-center">
            
            {/* The Main Orb */}
            <div className={`absolute inset-0 transition-opacity duration-1000 ${state === 'DISCONNECTED' || state === 'ERROR' ? 'opacity-30 grayscale' : 'opacity-100'}`}>
              <PersonaAvatar voiceName={voiceName} energy={Math.max(volume, outputVolume) / 100} />
            </div>
            
            <button
              onClick={handleToggleRecording}
              className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl backdrop-blur-md border ${
                state === 'DISCONNECTED' || state === 'ERROR'
                  ? 'bg-slate-800/50 hover:bg-slate-700/80 text-slate-300 border-white/10'
                  : state === 'CONNECTING'
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/50'
                  : 'bg-sky-500/20 text-sky-300 border-sky-500/50 hover:bg-sky-500/30'
              }`}
            >
              {state === 'DISCONNECTED' || state === 'ERROR' ? (
                <MicOff className="w-8 h-8" />
              ) : state === 'CONNECTING' ? (
                <Loader2 className="w-8 h-8 animate-spin" />
              ) : (
                <Mic className="w-8 h-8" />
              )}
            </button>
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-medium tracking-tight">
              {state === 'DISCONNECTED' && 'Ready to Translate'}
              {state === 'CONNECTING' && 'Connecting to Gemini...'}
              {state === 'LISTENING_ACTIVE' && 'Listening...'}
              {state === 'TRANSLATING' && 'Translating...'}
              {state === 'ERROR' && 'Connection Error'}
            </h2>
            {(state === 'LISTENING_ACTIVE' || state === 'TRANSLATING') && activeDeviceLabel && (
              <p className="text-xs text-sky-400 mt-2 font-mono uppercase tracking-widest">
                Using: {activeDeviceLabel}
              </p>
            )}
            <p className="text-slate-400 mt-2 max-w-md mx-auto">
              {state === 'DISCONNECTED' && 'Tap the microphone to start real-time translation from French, Creole, Spanish, or Bosnian.'}
              {state === 'ERROR' && error}
            </p>
          </div>
        </div>

        {/* Transcript */}
        <div className="flex-1 bg-slate-900/80 rounded-3xl border border-slate-800 border-t-sky-500/50 shadow-[0_-4px_24px_-8px_rgba(14,165,233,0.2)] p-6 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Live Transcript</h3>
            {transcript.length > 0 && (
              <button 
                onClick={clearTranscript}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            {transcript.length === 0 && !activeTranscript ? (
              <div className="h-full flex items-center justify-center text-slate-600 italic">
                No translations yet. Start speaking to see the transcript.
              </div>
            ) : (
              <>
                {transcript.map((t, i) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={t.id || i} 
                    className="bg-slate-950/50 rounded-2xl p-4 border border-slate-800/50 flex gap-4 items-start"
                  >
                    <div className="flex-1 flex flex-col gap-2">
                      {t.source && t.translation && (
                        <div className="text-sm text-slate-400 italic border-l-2 border-slate-800 pl-3 py-1">
                          {t.source}
                        </div>
                      )}
                      {t.translation && (
                        <p className={`text-lg leading-relaxed ${t.isFinal ? 'text-slate-100' : 'text-slate-300'}`}>
                          {t.translation}
                        </p>
                      )}
                      {t.source && !t.translation && (
                        <p className="text-lg text-slate-100 leading-relaxed">{t.source}</p>
                      )}
                      {!t.translation && !t.source && (
                        <p className="text-lg text-slate-100 leading-relaxed">{t.translation}</p>
                      )}
                    </div>
                  </motion.div>
                ))}
                
                {/* Active Transcript */}
                {activeTranscript && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-slate-950/50 rounded-2xl p-4 border border-sky-500/30 flex gap-4 items-start"
                  >
                    <div className="flex-1">
                      <p className="text-lg leading-relaxed text-slate-300">
                        {activeTranscript}
                        <span className="inline-block w-2 h-2 ml-2 bg-sky-500 rounded-full animate-pulse" />
                      </p>
                    </div>
                  </motion.div>
                )}
                
                <div ref={transcriptEndRef} />
              </>
            )}
          </div>
        </div>

      </div>
    </main>
  );
}
