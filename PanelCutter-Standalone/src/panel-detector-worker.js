import * as ort from 'onnxruntime-web/wasm';
import { decodePanelPredictions, makePanelModelInput } from './panel-detector-core.js';

let session;

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === 'init') {
    try {
      self.postMessage({ type: 'status', message: 'Preparing ONNX runtime…' });
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = {
        mjs: self.location.protocol === 'file:'
          ? new URL('./ort-wasm-simd-threaded.mjs', self.location.href).href
          : new URL('/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', self.location.href).href,
      };
      ort.env.wasm.wasmBinary = new Uint8Array(message.wasm);
      self.postMessage({ type: 'status', message: 'Creating model session…' });
      session = await ort.InferenceSession.create(new Uint8Array(message.model), { executionProviders: ['wasm'] });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'init-error', message: error?.message || String(error) });
    }
    return;
  }
  if (message.type !== 'detect' || !session) return;
  try {
    const rgba = new Uint8Array(message.rgba);
    const { tensor } = makePanelModelInput(rgba, message.width, message.height);
    const input = new ort.Tensor('float32', tensor, [1, 3, 640, 640]);
    const output = await session.run({ images: input });
    const boxes = decodePanelPredictions(output.predictions.data, message.width, message.height, message.reading);
    self.postMessage({ type: 'result', id: message.id, boxes });
  } catch (error) {
    self.postMessage({ type: 'error', id: message.id, message: error?.message || String(error) });
  }
};
