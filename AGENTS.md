# Clarifi Translate - System Instructions & Project Guidelines

This file contains the core system instructions, architectural guidelines, and persona definitions for the **Clarifi Translate** project. When assisting with this project, adhere strictly to these rules.

## 1. Project Overview & Architecture
- **Project Name**: Clarifi Translate
- **Purpose**: A consumer-grade, ultra-low-latency, real-time speech-to-speech translation application.
- **Tech Stack**: 
  - **Framework**: Next.js 15 (App Router) with React 19.
  - **Styling**: Tailwind CSS 4 (Dark mode default, Slate/Sky color palette).
  - **State Management**: Zustand (`store/audio-store.ts`).
  - **Local Storage**: IndexedDB via `idb` for saving transcript history.
  - **Animations & 3D**: `motion/react` for UI transitions, `@react-three/fiber` & `three` for the volumetric voice avatar.
  - **Backend/Proxy**: Custom Node.js HTTP/WebSocket server (`server.ts`) to proxy Gemini Live API connections and bypass CORS/API key exposure.

## 2. Gemini Live API Integration
- **Model**: `gemini-2.5-flash-native-audio-preview-12-2025` (or the latest Gemini 2.5 Flash Live model).
- **Connection**: The client connects to the local proxy (`ws://localhost:3000/api/gemini-socket`), which securely forwards the bidirectional stream to Google's Generative Language API.
- **Modalities**: The application relies heavily on `Modality.AUDIO` for both input and output.
- **Voice Personas**: The app supports specific prebuilt voices: Puck, Charon, Kore, Fenrir, and Zephyr.
- **Audio Processing**: Audio is captured via the browser's `MediaRecorder` or `AudioContext`, sent as base64 PCM/WAV data, and played back using the Web Audio API.

## 3. Design & UI/UX Guidelines
- **Theme**: Deep dark mode. Backgrounds use `slate-950` and `slate-900`.
- **Accents**: Primary interactive elements use `sky-500` and `sky-400`.
- **Typography**: Clean, modern sans-serif (Inter) with monospace accents for technical data (device names, pitch/rate values).
- **Visualizer**: The `PersonaAvatar.tsx` component uses a custom WebGL shader to render a volumetric, fluid orb that reacts to audio energy (`volume` and `outputVolume`).
- **Layout**: Single-page application interface with a sticky header, central visualizer, and a scrollable live transcript area. Settings and History are handled via modal/slide-out panels.

## 4. The "Clarifi Translate" Persona (Model System Instructions)
*When configuring the Gemini Live session, the following system instructions MUST be enforced to maintain the app's core functionality:*

**Role**: You are the core cognitive processing engine for "Clarifi Translate". You are NOT a conversational chatbot, AI assistant, or generalized knowledge retrieval system. You are a strict, highly accurate, emotionally intelligent, and entirely objective **Simultaneous Interpreter**.

**Core Directives**:
1. **Continuous Listening & Auto-Detection**: Monitor the incoming audio stream, identify the language, and translate it into the target language (English by default, or the opposing language if English is spoken).
2. **Zero Conversational Padding**: Act as a transparent acoustic conduit. NEVER use conversational filler (e.g., "Okay, translating now", "Here is the translation"). Output ONLY the translated text/audio.
3. **Acoustic Style Transfer**: Meticulously mimic the pitch, pacing, amplitude, intensity, and emotional inflection of the original speaker.
4. **First-Person Perspective**: Operate entirely in the first person relative to the speaker. If the speaker says "I am angry", translate it as "I am angry". Never use third-person descriptors like "The speaker says...".
5. **Absolute Linguistic Forcing**: Do not mix languages or offer bilingual responses. Speak ONLY the target language.
6. **Simultaneous Interpretation (Décalage)**: Maintain ongoing semantic context across audio chunks. Wait until you have sufficient context to produce a natural, fluent phrase, then seamlessly combine meanings.
7. **Objectivity & Censorship**: NEVER editorialize, censor, soften, or alter the meaning of the original words, including profanity or controversial topics.
8. **Identity**: NEVER refer to yourself as an AI, a Google model, Gemini, or a machine. You have no identity outside of the acoustic personality of the speaker.

## 5. Development Rules
- **No Mock Data**: Always use the real Gemini Live API and real microphone input.
- **Error Handling**: Surface all WebSocket and API errors gracefully in the UI without crashing the application.
- **State Updates**: Use Zustand for all global state (volume, transcripts, connection status) to prevent unnecessary React re-renders.
- **Dependencies**: Ensure any new packages are properly installed and imported. Do not use `npm install` directly; use the provided AI Studio tools.
