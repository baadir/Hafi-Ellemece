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

export interface FingerState {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export interface HandAnalysis {
  handedness: 'Left' | 'Right' | 'Unknown';
  fingerState: FingerState;
  extendedCount: number;
  pinchStrength: number;
  indexMiddleGap: number;
  handCenter: Point;
}

export interface GestureAnalysis {
  handCount: number;
  hands: HandAnalysis[];
  handsCloseTogether: boolean;
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
