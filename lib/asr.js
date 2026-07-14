/**
 * Speech recognition via sherpa-onnx-node
 * Streaming Zipformer transducer (Chinese)
 * Audio is captured in the renderer via Web Audio and fed over IPC.
 */

const path = require('path');
const fs = require('fs');

let recognizer = null;
let stream = null;
let isRunning = false;

const MODELS_DIR = path.join(__dirname, '..', 'models');
const MODEL_SUBDIR = 'sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30';
const TARGET_SAMPLE_RATE = 16000;

/**
 * Check that required model files exist
 */
function checkModels() {
  const modelDir = path.join(MODELS_DIR, MODEL_SUBDIR);
  const files = [
    'encoder.int8.onnx',
    'decoder.onnx',
    'joiner.int8.onnx',
    'tokens.txt'
  ];

  for (const file of files) {
    const fullPath = path.join(modelDir, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(
        `模型文件未找到: ${file}\n` +
        `请确认 models/${MODEL_SUBDIR}/ 目录下有完整的模型文件`
      );
    }
  }
}

/**
 * Initialize the ASR engine
 */
async function initASR() {
  if (recognizer) {
    // Reuse engine, reset stream for a new session
    stream = recognizer.createStream();
    isRunning = true;
    console.log('[ASR] 重用已有引擎，创建新stream');
    return;
  }

  checkModels();

  const sherpa = require('sherpa-onnx-node');
  const modelDir = path.join(MODELS_DIR, MODEL_SUBDIR);

  const config = {
    featConfig: {
      sampleRate: TARGET_SAMPLE_RATE,
      featureDim: 80
    },
    modelConfig: {
      transducer: {
        encoder: path.join(modelDir, 'encoder.int8.onnx'),
        decoder: path.join(modelDir, 'decoder.onnx'),
        joiner: path.join(modelDir, 'joiner.int8.onnx')
      },
      tokens: path.join(modelDir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: false
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20
  };

  recognizer = new sherpa.OnlineRecognizer(config);
  stream = recognizer.createStream();
  isRunning = true;

  console.log('[ASR] Zipformer 中文识别引擎初始化完成');
}

/**
 * Feed audio samples from the renderer for recognition
 * @param {Float32Array} samples
 * @param {number} [sampleRate=16000] - actual capture rate (sherpa resamples if needed)
 * @returns {{ text: string, isFinal: boolean } | null}
 */
function feedAudio(samples, sampleRate = TARGET_SAMPLE_RATE) {
  if (!isRunning || !stream || !recognizer) return null;

  const rate = Number(sampleRate) > 0 ? Number(sampleRate) : TARGET_SAMPLE_RATE;
  stream.acceptWaveform({ samples, sampleRate: rate });

  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }

  const result = recognizer.getResult(stream);
  const text = (result.text || '').trim();
  const isEndpoint = recognizer.isEndpoint(stream);

  if (isEndpoint && text) {
    recognizer.reset(stream);
    return { text, isFinal: true };
  } else if (text) {
    return { text, isFinal: false };
  }

  return null;
}

/**
 * Stop recognition and return any remaining partial text
 * @returns {string}
 */
function stopRecognition() {
  isRunning = false;

  let finalText = '';
  if (stream && recognizer) {
    stream.inputFinished();
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
    const result = recognizer.getResult(stream);
    finalText = (result.text || '').trim();
    stream = null;
  }

  console.log('[ASR] 停止录制');
  return finalText;
}

module.exports = { initASR, feedAudio, stopRecognition };
