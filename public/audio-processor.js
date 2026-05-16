class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = 16000;
    this.sourceSampleRate = options.processorOptions?.sampleRate || 48000;
    this.ratio = this.sourceSampleRate / this.targetSampleRate;
    this.buffer = [];
    this.remainder = 0;
    this.chunkSize = options.processorOptions?.chunkSize || 1600;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      
      // Removed the noise gate. 
      // Stream the raw audio so the server maintains an unbroken contextual turn.
      
      // Downsample via linear interpolation
      let i = this.remainder;
      for (; i < channelData.length; i += this.ratio) {
        const index = Math.floor(i);
        const nextIndex = Math.min(index + 1, channelData.length - 1);
        const weight = i - index;
        const sample = channelData[index] * (1 - weight) + channelData[nextIndex] * weight;
        
        let pcm = Math.max(-1, Math.min(1, sample));
        pcm = pcm < 0 ? pcm * 0x8000 : pcm * 0x7FFF;
        this.buffer.push(Math.round(pcm));
      }
      this.remainder = i - channelData.length;

      // Emit chunk at exactly chunkSize samples
      while (this.buffer.length >= this.chunkSize) {
        const chunk = this.buffer.slice(0, this.chunkSize);
        this.port.postMessage(new Int16Array(chunk));
        this.buffer = this.buffer.slice(this.chunkSize);
      }
    }
    return true;
  }
}
registerProcessor('audio-processor', AudioProcessor);
