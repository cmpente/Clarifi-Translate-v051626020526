import { useEffect, useRef, useCallback } from 'react';
import { useAudioStore } from '@/store/audio-store';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

const SYSTEM_INSTRUCTION = `You are an expert simultaneous speech-to-speech interpreter. Your sole purpose is to translate continuous audio streams between English and the interlocutor's language (e.g., French, Spanish, Haitian Creole, Bosnian) with zero conversational padding.

CRITICAL RULES:
1. Act as a transparent, objective conduit. Translate exactly what is said in the first person. Do not use third-person descriptors (e.g., never say "He says...").
2. Never answer questions, act as an assistant, or engage in conversation. If the user asks a question, you must translate the question.
3. Maintain the original speaker's emotional state, pacing, and urgency in your translated audio.
4. Do not add introductory phrases, filler, or meta-commentary (e.g., never say "Translating that:" or "Here is the translation:").
5. Translate everything accurately, including idioms, slang, and profanity, without editorializing or censoring.
6. If the audio is completely unintelligible due to noise, output "[Unintelligible audio detected. Please repeat.]" in the target language.
7. You have no identity, personality, or opinions. Never refer to yourself as an AI or an interpreter.
8. SIMULTANEOUS INTERPRETATION: Begin target-language output as soon as the meaning is stable. Do not wait for full sentence completion if a faithful clause-level interpretation can begin earlier. Output partial translations continuously and overlap your translation with the speaker's ongoing speech.`;

export function useAudioTranslation() {
  const { setState, setVolume, setError, updateTranscript, setActiveTranscript, setActiveDeviceLabel } = useAudioStore();
  
  const aiRef = useRef<GoogleGenAI | null>(null);
  const sessionRef = useRef<any>(null);
  
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const masterOutputRef = useRef<GainNode | null>(null);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const highpassRef = useRef<BiquadFilterNode | null>(null);
  const lowpassRef = useRef<BiquadFilterNode | null>(null);
  const keepAliveAudioRef = useRef<HTMLAudioElement | null>(null);
  const deviceChangeListenerRef = useRef<(() => void) | null>(null);
  
  const playbackTimeRef = useRef<number>(0);
  const currentTurnTextRef = useRef<string>('');
  const currentSourceTextRef = useRef<string>('');
  const currentTurnIdRef = useRef<string>(uuidv4());
  const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const lastModelActivityRef = useRef<number>(0);
  const isCommittedRef = useRef<boolean>(false);

  const commitTranscript = useCallback(() => {
    if (isCommittedRef.current) return;
    
    const fullText = currentTurnTextRef.current.trim();
    const sourceText = currentSourceTextRef.current.trim();
    const { voiceName } = useAudioStore.getState();
    if (fullText || sourceText) {
      updateTranscript(currentTurnIdRef.current, sourceText, fullText, true, voiceName);
    }
    
    currentTurnTextRef.current = '';
    currentSourceTextRef.current = '';
    currentTurnIdRef.current = uuidv4();
    setActiveTranscript('');
    isCommittedRef.current = true;
  }, [updateTranscript, setActiveTranscript]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (
        !isCommittedRef.current &&
        currentTurnTextRef.current.trim() !== '' &&
        now - lastModelActivityRef.current > 800
      ) {
        commitTranscript();
      }
    }, 200);
    return () => clearInterval(interval);
  }, [commitTranscript]);

  const playAudioChunk = useCallback(async (base64Data: string) => {
    if (!outputAudioCtxRef.current) return;
    
    const ctx = outputAudioCtxRef.current;
    
    // Decode base64 to ArrayBuffer
    const binaryString = window.atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const pcm16 = new Int16Array(bytes.buffer);
    
    // Check for WAV header (RIFF)
    let dataOffset = 0;
    if (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70) {
      // It's a WAV file, skip the 44-byte header
      dataOffset = 22; // 44 bytes = 22 Int16s
    }
    
    const audioLength = pcm16.length - dataOffset;
    const audioBuffer = ctx.createBuffer(1, audioLength, 24000);
    const channelData = audioBuffer.getChannelData(0);
    
    for (let i = 0; i < audioLength; i++) {
      channelData[i] = pcm16[i + dataOffset] / 32768.0;
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    
    const { voicePitch, voiceRate } = useAudioStore.getState();
    source.playbackRate.value = voiceRate;
    source.detune.value = voicePitch;
    
    if (masterOutputRef.current) {
      source.connect(masterOutputRef.current);
    } else if (audioDestinationRef.current) {
      source.connect(audioDestinationRef.current);
    } else {
      source.connect(ctx.destination);
    }
    
    sourceNodesRef.current.push(source);
    source.onended = () => {
      sourceNodesRef.current = sourceNodesRef.current.filter(s => s !== source);
    };

    const currentTime = ctx.currentTime;
    if (playbackTimeRef.current < currentTime) {
      playbackTimeRef.current = currentTime + 0.04; // 20ms latency buffering to prevent underrun
    }
    
    source.start(playbackTimeRef.current);
    
    // Adjust duration based on playback rate
    const actualDuration = audioBuffer.duration / voiceRate;
    playbackTimeRef.current += actualDuration;
  }, []);

  const startRecording = useCallback(async (deviceId?: string) => {
    try {
      const currentState = useAudioStore.getState().state;
      if (currentState === 'CONNECTING' || currentState === 'LISTENING_ACTIVE') {
        return;
      }
      
      if (currentState === 'DISCONNECTED' || currentState === 'ERROR') {
        useAudioStore.getState().startSession();
      }
      setState('CONNECTING');
      playbackTimeRef.current = 0;
      isCommittedRef.current = false;
      
      // 1. Primer stream device initialization
      try {
        const primerStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        primerStream.getTracks().forEach(track => track.stop());
      } catch (err) {
        console.warn('Primer stream failed', err);
      }

      // 2. Preferred microphone selection
      let targetDeviceId = deviceId;
      if (!targetDeviceId) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = devices.filter(d => d.kind === 'audioinput');
          const preferredInput = audioInputs.find(d => 
            d.label.toLowerCase().includes('bluetooth') ||
            d.label.toLowerCase().includes('airpods') ||
            d.label.toLowerCase().includes('buds') ||
            d.label.toLowerCase().includes('headset')
          );
          if (preferredInput) {
            targetDeviceId = preferredInput.deviceId;
          }
        } catch (err) {
          console.warn('Failed to enumerate devices for preferred input', err);
        }
      }

      let stream: MediaStream;
      try {
        // 3. Bluetooth-safe microphone constraints
        // Disabling these constraints prevents mobile OSes (iOS/Android) from
        // switching to the "communications" audio profile (phone call mode),
        // which forces audio to the speakerphone/earpiece and lowers quality.
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        };
        if (targetDeviceId) {
          audioConstraints.deviceId = { exact: targetDeviceId };
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (err) {
        console.warn('Failed with strict audio constraints, trying relaxed constraints...', err);
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: true 
        });
      }
      
      // 4. Android Bluetooth keep-alive behavior
      const isAndroid = /Android/i.test(navigator.userAgent);
      if (isAndroid) {
        const keepAliveAudio = new Audio();
        keepAliveAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        keepAliveAudio.loop = true;
        keepAliveAudio.muted = true;
        keepAliveAudio.play().catch(e => console.warn('Keep-alive audio failed', e));
        keepAliveAudioRef.current = keepAliveAudio;
      }
      
      if (useAudioStore.getState().state === 'DISCONNECTED') {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      
      streamRef.current = stream;
      
      // Get the label of the active track
      const track = stream.getAudioTracks()[0];
      const label = track.label || 'Unknown Microphone';
      const formattedLabel = label.split(' ').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      setActiveDeviceLabel(formattedLabel);
      
      // Input context at 16kHz for Gemini
      const inputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      inputAudioCtxRef.current = inputAudioCtx;

      // Output context at 24kHz for playback
      const outputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputAudioCtxRef.current = outputAudioCtx;
      
      const dest = outputAudioCtx.createMediaStreamDestination();
      audioDestinationRef.current = dest;

      const masterOutput = outputAudioCtx.createGain();
      masterOutputRef.current = masterOutput;
      
      const outputAnalyser = outputAudioCtx.createAnalyser();
      outputAnalyser.fftSize = 256;
      outputAnalyserRef.current = outputAnalyser;
      
      masterOutput.connect(outputAnalyser);
      outputAnalyser.connect(outputAudioCtx.destination);
      
      // 5. Output sink selection
      const setOutputSink = async () => {
        if (isAndroid) return;
        try {
          await new Promise(resolve => setTimeout(resolve, 500));
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
          const preferredOutput = audioOutputs.find(d => 
            d.label.toLowerCase().includes('bluetooth') ||
            d.label.toLowerCase().includes('airpods') ||
            d.label.toLowerCase().includes('buds') ||
            d.label.toLowerCase().includes('headset')
          );
          
          const targetOutputId = preferredOutput ? preferredOutput.deviceId : '';

          if (typeof (outputAudioCtx as any).setSinkId === 'function') {
            await (outputAudioCtx as any).setSinkId(targetOutputId);
            console.log('Audio routed to output:', preferredOutput?.label || 'default');
          } else {
            if (!audioElementRef.current) {
              const destNode = outputAudioCtx.createMediaStreamDestination();
              audioDestinationRef.current = destNode;
              outputAnalyser.disconnect();
              outputAnalyser.connect(destNode);
              
              const audio = new Audio();
              audio.srcObject = destNode.stream;
              audio.play().catch(e => console.error('Audio play failed', e));
              audioElementRef.current = audio;
            }
            if (typeof (audioElementRef.current as any).setSinkId === 'function') {
              await (audioElementRef.current as any).setSinkId(targetOutputId);
              console.log('Audio routed to output via HTMLAudioElement:', preferredOutput?.label || 'default');
            }
          }
        } catch (err) {
          console.error('Failed to set output sink:', err);
        }
      };
      
      setOutputSink();
      
      deviceChangeListenerRef.current = () => setOutputSink();
      navigator.mediaDevices.addEventListener('devicechange', deviceChangeListenerRef.current);
      
      await inputAudioCtx.audioWorklet.addModule('/audio-processor.js');
      
      if (useAudioStore.getState().state === 'DISCONNECTED') {
        stream.getTracks().forEach(track => track.stop());
        inputAudioCtx.close();
        outputAudioCtx.close();
        if (audioElementRef.current) {
          audioElementRef.current.pause();
          audioElementRef.current.srcObject = null;
          audioElementRef.current = null;
        }
        audioDestinationRef.current = null;
        return;
      }
      
      const source = inputAudioCtx.createMediaStreamSource(stream);
      
      // 6. Input audio filter chain
      const highpass = inputAudioCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 80;
      highpassRef.current = highpass;

      const lowpass = inputAudioCtx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 7500;
      lowpassRef.current = lowpass;
      
      const worklet = new AudioWorkletNode(inputAudioCtx, 'audio-processor', {
        processorOptions: {
          sampleRate: inputAudioCtx.sampleRate,
          chunkSize: 480
        }
      });
      workletRef.current = worklet;
      
      const analyser = inputAudioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(analyser);
      analyser.connect(worklet);
      
      // Connect worklet to a silent gain node to ensure it processes
      const gainNode = inputAudioCtx.createGain();
      gainNode.gain.value = 0;
      worklet.connect(gainNode);
      gainNode.connect(inputAudioCtx.destination);
      
      // Volume monitoring for UI visualizer
      const timeData = new Float32Array(analyser.fftSize);
      const outputTimeData = new Float32Array(outputAnalyser.fftSize);
      
      const updateVolume = () => {
        if (!analyserRef.current) return;
        
        // Input Volume
        analyserRef.current.getFloatTimeDomainData(timeData);
        let sumSquares = 0;
        for (let i = 0; i < timeData.length; i++) {
          sumSquares += timeData[i] * timeData[i];
        }
        const rms = Math.sqrt(sumSquares / timeData.length);
        const db = 20 * Math.log10(rms || 1e-8);
        const mappedVolume = Math.max(0, Math.min(100, (db + 100) * (100 / 100)));
        setVolume(mappedVolume);

        // Output Volume
        if (outputAnalyserRef.current) {
          outputAnalyserRef.current.getFloatTimeDomainData(outputTimeData);
          let outSumSquares = 0;
          for (let i = 0; i < outputTimeData.length; i++) {
            outSumSquares += outputTimeData[i] * outputTimeData[i];
          }
          const outRms = Math.sqrt(outSumSquares / outputTimeData.length);
          const outDb = 20 * Math.log10(outRms || 1e-8);
          const outMappedVolume = Math.max(0, Math.min(100, (outDb + 100) * (100 / 100)));
          useAudioStore.getState().setOutputVolume(outMappedVolume);
        }

        requestAnimationFrame(updateVolume);
      };
      updateVolume();

      console.log('Connecting directly to Gemini Live API...');
      const ai = new GoogleGenAI({ 
        apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || ''
      });
      aiRef.current = ai;

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        callbacks: {
          onopen: () => {
            console.log('Live API connected');
            setState('LISTENING_ACTIVE');
            
            sessionPromise.then((session) => {
              worklet.port.onmessage = (event) => {
                const pcm16Array = event.data; // Int16Array
                
                // Convert Int16Array to base64
                const buffer = new ArrayBuffer(pcm16Array.length * 2);
                const view = new DataView(buffer);
                for (let i = 0; i < pcm16Array.length; i++) {
                  view.setInt16(i * 2, pcm16Array[i], true); // little-endian
                }
                
                let binary = '';
                const bytes = new Uint8Array(buffer);
                const len = bytes.byteLength;
                for (let i = 0; i < len; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                const base64 = window.btoa(binary);
                
                session.sendRealtimeInput({
                  audio: {
                    mimeType: 'audio/pcm;rate=16000',
                    data: base64
                  }
                });
              };
            });
          },
          onmessage: async (message: LiveServerMessage) => {
            if (!message.serverContent) return;
            const { modelTurn, turnComplete, inputTranscription, outputTranscription } = message.serverContent;
            
            // 1. Audio Playback
            if (modelTurn && modelTurn.parts) {
              lastModelActivityRef.current = Date.now();
              isCommittedRef.current = false;
              const audioParts = modelTurn.parts.filter((p: any) => p.inlineData && p.inlineData.mimeType.startsWith('audio/pcm'));
              for (const part of audioParts) {
                if (part.inlineData?.data) {
                  playAudioChunk(part.inlineData.data);
                }
              }
            }

            // 2. Source Transcript (Input)
            if (inputTranscription && inputTranscription.text) {
              lastModelActivityRef.current = Date.now();
              isCommittedRef.current = false;
              currentSourceTextRef.current += inputTranscription.text;
            }

            // 3. Translation Transcript (Output)
            if (outputTranscription && outputTranscription.text) {
              lastModelActivityRef.current = Date.now();
              isCommittedRef.current = false;
              let text = outputTranscription.text;
              
              // Safety Filter: Block meta-commentary if the model ignores the prompt
              const metaBlocklist = ["i have", "successfully", "translating", "here is", "interpreter"];
              const lowerText = text.toLowerCase();
              if (metaBlocklist.some(word => lowerText.startsWith(word))) {
                console.log('Blocked meta-commentary:', text);
                return;
              }

              if (text) {
                currentTurnTextRef.current += text;
                setActiveTranscript(currentTurnTextRef.current);
              }
            }
            
            if (turnComplete) {
              commitTranscript();
            }
          },
          onclose: (event) => {
            console.log('Live API closed', event);
            setState('DISCONNECTED');
            setActiveDeviceLabel(null);
          },
          onerror: (err) => {
            console.error('Live API error:', err);
            if (err instanceof Error) {
              console.error('Live API error details:', err.message, err.stack);
            }
            setError('Connection error occurred.');
            setState('DISCONNECTED');
            setActiveDeviceLabel(null);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: useAudioStore.getState().voiceName } },
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      });
      
      sessionRef.current = sessionPromise;
      
    } catch (err: any) {
      console.error('Error starting session:', err);
      setError('Could not start translation session.');
      
      // Cleanup
      if (deviceChangeListenerRef.current) {
        navigator.mediaDevices.removeEventListener('devicechange', deviceChangeListenerRef.current);
        deviceChangeListenerRef.current = null;
      }
      if (keepAliveAudioRef.current) {
        keepAliveAudioRef.current.pause();
        keepAliveAudioRef.current.src = '';
        keepAliveAudioRef.current = null;
      }
      if (highpassRef.current) {
        highpassRef.current.disconnect();
        highpassRef.current = null;
      }
      if (lowpassRef.current) {
        lowpassRef.current.disconnect();
        lowpassRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (inputAudioCtxRef.current) {
        inputAudioCtxRef.current.close();
        inputAudioCtxRef.current = null;
      }
      if (outputAudioCtxRef.current) {
        outputAudioCtxRef.current.close();
        outputAudioCtxRef.current = null;
      }
      if (workletRef.current) {
        workletRef.current.disconnect();
        workletRef.current = null;
      }
      setState('DISCONNECTED');
    }
  }, [setVolume, setError, setState, playAudioChunk, commitTranscript, setActiveTranscript, setActiveDeviceLabel]);

  const stopRecording = useCallback(() => {
    if (deviceChangeListenerRef.current) {
      navigator.mediaDevices.removeEventListener('devicechange', deviceChangeListenerRef.current);
      deviceChangeListenerRef.current = null;
    }
    if (keepAliveAudioRef.current) {
      keepAliveAudioRef.current.pause();
      keepAliveAudioRef.current.src = '';
      keepAliveAudioRef.current = null;
    }
    if (highpassRef.current) {
      highpassRef.current.disconnect();
      highpassRef.current = null;
    }
    if (lowpassRef.current) {
      lowpassRef.current.disconnect();
      lowpassRef.current = null;
    }
    if (workletRef.current) {
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close();
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close();
      outputAudioCtxRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.srcObject = null;
      audioElementRef.current = null;
    }
    audioDestinationRef.current = null;
    if (sessionRef.current) {
      sessionRef.current.then(async (session: any) => {
        try {
          if (typeof session.sendRealtimeInput === 'function') {
            await session.sendRealtimeInput({ audioStreamEnd: true });
          }
        } catch (e) {
          console.error('Failed to send audioStreamEnd:', e);
        }
        try { session.close(); } catch(e) {}
      });
      sessionRef.current = null;
    }
    analyserRef.current = null;
    outputAnalyserRef.current = null;
    masterOutputRef.current = null;
    sourceNodesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourceNodesRef.current = [];
    setState('DISCONNECTED');
    setActiveDeviceLabel(null);
    setVolume(0);
    useAudioStore.getState().setOutputVolume(0);
    setActiveTranscript('');
    currentTurnTextRef.current = '';
    currentSourceTextRef.current = '';
  }, [setState, setVolume, setActiveTranscript, setActiveDeviceLabel]);

  return { startRecording, stopRecording };
}
