// Minimal types for the npm `ggwave` 0.4.0 Emscripten module (no types ship with it).
declare module 'ggwave' {
  export interface GgwaveParameters {
    payloadLength: number;
    sampleRateInp: number;
    sampleRateOut: number;
    sampleRate: number;
    samplesPerFrame: number;
    soundMarkerThreshold: number;
    sampleFormatInp: number;
    sampleFormatOut: number;
    operatingMode: number;
  }
  export interface GgwaveApi {
    ProtocolId: Record<string, number>;
    getDefaultParameters(): GgwaveParameters;
    init(parameters: GgwaveParameters): number;
    free(instance: number): void;
    /** `data` may be a string or raw bytes (the C++ side takes a std::string, which embind fills byte for byte from a Uint8Array). Returns a view of Int8 holding Float32 samples. */
    encode(instance: number, data: string | Uint8Array, protocol: number, volume: number): Int8Array;
    /** `samples` is Float32 audio reinterpreted as Int8Array. Returns the decoded bytes, or an empty array. */
    decode(instance: number, samples: Int8Array): Uint8Array;
    disableLog(): void;
  }
  const factory: () => Promise<GgwaveApi>;
  export default factory;
}
