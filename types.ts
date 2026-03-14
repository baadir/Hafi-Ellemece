/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface Point {
  x: number;
  y: number;
}

export interface LetterRecognitionResult {
  letter: string;
  confidence: number;
  message?: string;
}

export interface GameState {
  targetWord: string;
  currentLetterIndex: number;
  recognizedLetters: string[];
  score: number;
  status: 'idle' | 'playing' | 'success' | 'failure';
}

export interface DebugInfo {
  latency: number;
  screenshotBase64?: string;
  promptContext: string;
  rawResponse: string;
  parsedResponse?: any;
  error?: string;
  timestamp: string;
}

export interface AiResponse {
  result: LetterRecognitionResult;
  debug: DebugInfo;
}

// MediaPipe Type Definitions (Augmenting window)
declare global {
  interface Window {
    Hands: any;
    Camera: any;
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
  }
}
