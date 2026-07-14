/**
 * 语音识别模块 - 基于 sherpa-onnx-node
 * 使用 streaming Zipformer transducer 实现实时中文语音识别
 * 录音通过 Electron 渲染进程的 Web Audio API 采集，音频数据通过 IPC 传入
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
 * 检查模型文件是否存在
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
 * 初始化 ASR 引擎
 */
async function initASR() {
  if (recognizer) {
    // 已初始化，重置stream即可
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
 * 接收渲染进程发来的音频数据进行识别
 * @param {Float32Array} samples - 音频采样
 * @param {number} [sampleRate=16000] - 实际采集采样率（与目标不一致时由 sherpa 重采样）
 * @returns {{ text: string, isFinal: boolean } | null}
 */
function feedAudio(samples, sampleRate = TARGET_SAMPLE_RATE) {
  if (!isRunning || !stream || !recognizer) return null;

  const rate = Number(sampleRate) > 0 ? Number(sampleRate) : TARGET_SAMPLE_RATE;
  // sherpa-onnx-node API: acceptWaveform({ samples, sampleRate })
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
 * 停止识别
 * @returns {string} 最后的未确认文本
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
