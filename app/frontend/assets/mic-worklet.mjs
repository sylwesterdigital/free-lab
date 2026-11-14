/* Low overhead microphone samples, processed on the browser audio rendering thread. */
class FreeLabMicRecorder extends AudioWorkletProcessor {
 constructor(){super();this.pending=new Float32Array(2048);this.count=0;}
 process(inputs,outputs){
  const samples=inputs[0]?.[0];if(samples){for(let i=0;i<samples.length;i++){
   this.pending[this.count++]=samples[i];
   if(this.count===this.pending.length){const block=this.pending;this.port.postMessage({samples:block},[block.buffer]);this.pending=new Float32Array(2048);this.count=0;}
  }}
  const out=outputs[0]?.[0];if(out)out.fill(0);
  return true;
 }
}
registerProcessor('freelab-mic-recorder',FreeLabMicRecorder);
