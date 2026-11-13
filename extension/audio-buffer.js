// Bounded FIFO that retains partial blocks instead of inserting avoidable gaps.
(function (root) {
  class PcmRingBuffer {
    constructor(maxSamples) {
      this.maxSamples = Math.max(1, Math.floor(maxSamples));
      this.chunks = [];
      this.offset = 0;
      this.length = 0;
    }
    push(samples) {
      if (!samples.length) return;
      this.chunks.push(samples);
      this.length += samples.length;
      while (this.length > this.maxSamples) {
        const drop = Math.min(this.length - this.maxSamples, this.chunks[0].length - this.offset);
        this.offset += drop;
        this.length -= drop;
        if (this.offset === this.chunks[0].length) { this.chunks.shift(); this.offset = 0; }
      }
    }
    readInto(output) {
      let written = 0;
      while (written < output.length && this.chunks.length) {
        const chunk = this.chunks[0];
        const count = Math.min(output.length - written, chunk.length - this.offset);
        output.set(chunk.subarray(this.offset, this.offset + count), written);
        written += count;
        this.offset += count;
        this.length -= count;
        if (this.offset === chunk.length) { this.chunks.shift(); this.offset = 0; }
      }
      output.fill(0, written);
      return written;
    }
    clear() { this.chunks = []; this.offset = 0; this.length = 0; }
  }
  root.VCClientPcmRingBuffer = PcmRingBuffer;
  if (typeof module !== "undefined" && module.exports) module.exports = { PcmRingBuffer };
})(typeof globalThis !== "undefined" ? globalThis : this);
