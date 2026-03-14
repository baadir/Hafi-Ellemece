import React, { useEffect, useRef, useState } from 'react';
import { recognizeLetter } from '../services/geminiService';
import { DebugInfo, GameState, GestureAnalysis, HandAnalysis, Point } from '../types';
import { BrainCircuit, Camera, CheckCircle2, Loader2, Sparkles, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

type Landmark = Point & { z?: number };

const WORDS = ['MERHABA', 'İŞARET', 'TÜRKİYE', 'ELMA', 'KİTAP', 'GÜNEŞ', 'DENİZ', 'KALEM'];
const HOLD_DURATION = 1500;
const STILL_DISTANCE_THRESHOLD = 0.02;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const normalizeLetter = (value: string) => value.toLocaleUpperCase('tr-TR');

const getBaseLetter = (letter: string) => {
  const normalized = normalizeLetter(letter);
  const baseMap: Record<string, string> = {
    'Ö': 'O',
    'Ü': 'U',
    'Ç': 'C',
    'Ş': 'S',
    'Ğ': 'G',
    'İ': 'I',
  };

  return baseMap[normalized] || normalized;
};

const isFingerExtended = (tip: Landmark, pip: Landmark, mcp: Landmark) => {
  return tip.y < pip.y && pip.y < mcp.y;
};

const getHandCenter = (landmarks: Landmark[]): Point => {
  const total = landmarks.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );

  return {
    x: total.x / landmarks.length,
    y: total.y / landmarks.length,
  };
};

const analyzeHand = (landmarks: Landmark[], handedness: HandAnalysis['handedness']): HandAnalysis => {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const indexMcp = landmarks[5];
  const indexPip = landmarks[6];
  const indexTip = landmarks[8];
  const middleMcp = landmarks[9];
  const middlePip = landmarks[10];
  const middleTip = landmarks[12];
  const ringMcp = landmarks[13];
  const ringPip = landmarks[14];
  const ringTip = landmarks[16];
  const pinkyMcp = landmarks[17];
  const pinkyPip = landmarks[18];
  const pinkyTip = landmarks[20];

  const thumbExtended = handedness === 'Left'
    ? thumbTip.x < thumbIp.x
    : handedness === 'Right'
      ? thumbTip.x > thumbIp.x
      : Math.abs(thumbTip.x - thumbIp.x) > 0.04;

  const fingerState = {
    thumb: thumbExtended,
    index: isFingerExtended(indexTip, indexPip, indexMcp),
    middle: isFingerExtended(middleTip, middlePip, middleMcp),
    ring: isFingerExtended(ringTip, ringPip, ringMcp),
    pinky: isFingerExtended(pinkyTip, pinkyPip, pinkyMcp),
  };

  const extendedCount = Object.values(fingerState).filter(Boolean).length;

  return {
    handedness,
    fingerState,
    extendedCount,
    pinchStrength: distance(thumbTip, indexTip),
    indexMiddleGap: distance(indexTip, middleTip),
    handCenter: getHandCenter(landmarks),
  };
};

const buildGestureAnalysis = (results: any): GestureAnalysis | null => {
  const landmarksList = results.multiHandLandmarks as Landmark[][] | undefined;
  if (!landmarksList?.length) {
    return null;
  }

  const handednessList = results.multiHandedness || [];
  const hands = landmarksList.map((landmarks, index) => {
    const handedness = handednessList[index]?.label as HandAnalysis['handedness'] | undefined;
    return analyzeHand(landmarks, handedness || 'Unknown');
  });

  const handsCloseTogether = hands.length >= 2
    ? distance(hands[0].handCenter, hands[1].handCenter) < 0.22
    : false;

  return {
    handCount: hands.length,
    hands,
    handsCloseTogether,
  };
};

const getThreshold = (targetLetter: string) => {
  return ['Ü', 'Ö', 'İ', 'Ç', 'Ş', 'Ğ'].includes(normalizeLetter(targetLetter)) ? 0.42 : 0.6;
};

const isApproximateUmlautMatch = (
  targetLetter: string,
  detectedLetter: string,
  confidence: number,
  gestureAnalysis: GestureAnalysis | null
) => {
  const normalizedTarget = normalizeLetter(targetLetter);
  const normalizedDetected = normalizeLetter(detectedLetter);

  if (!['Ö', 'Ü'].includes(normalizedTarget)) {
    return false;
  }

  const expectedBase = getBaseLetter(normalizedTarget);
  if (![normalizedTarget, expectedBase].includes(normalizedDetected)) {
    return false;
  }

  const primaryHand = gestureAnalysis?.hands[0];
  const secondaryHand = gestureAnalysis?.hands[1];
  const secondaryLooksLikeModifier = Boolean(
    secondaryHand &&
    (
      secondaryHand.extendedCount <= 2 ||
      secondaryHand.fingerState.index ||
      secondaryHand.fingerState.middle
    )
  );

  const primaryLooksLikeUBase = normalizedTarget === 'Ü' && Boolean(
    primaryHand &&
    primaryHand.fingerState.index &&
    primaryHand.fingerState.middle &&
    !primaryHand.fingerState.ring
  );

  const primaryLooksLikeOBase = normalizedTarget === 'Ö' && Boolean(
    primaryHand &&
    primaryHand.pinchStrength < 0.11 &&
    primaryHand.extendedCount <= 2
  );

  return confidence >= 0.35 && Boolean(
    gestureAnalysis &&
    gestureAnalysis.handCount >= 2 &&
    (
      gestureAnalysis.handsCloseTogether ||
      secondaryLooksLikeModifier ||
      primaryLooksLikeUBase ||
      primaryLooksLikeOBase
    )
  );
};

const SignAndSpell: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const holdStartTimeRef = useRef<number | null>(null);
  const lastHandPosRef = useRef<Record<number, Point> | null>(null);
  const latestGestureAnalysisRef = useRef<GestureAnalysis | null>(null);

  const [gameState, setGameState] = useState<GameState>({
    targetWord: '',
    currentLetterIndex: 0,
    recognizedLetters: [],
    score: 0,
    status: 'idle'
  });
  const [loading, setLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [lastResult, setLastResult] = useState<{ letter: string; message: string } | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  const startNewGame = () => {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    setGameState((prev) => ({
      targetWord: word,
      currentLetterIndex: 0,
      recognizedLetters: [],
      score: prev.score,
      status: 'playing'
    }));
    setLastResult(null);
  };

  const handleCapture = async () => {
    if (!canvasRef.current || isAnalyzing) {
      return;
    }

    setIsAnalyzing(true);
    setHoldProgress(0);
    holdStartTimeRef.current = null;

    const canvas = canvasRef.current;
    const offscreen = document.createElement('canvas');
    offscreen.width = 480;
    offscreen.height = 360;

    const oCtx = offscreen.getContext('2d');
    if (oCtx) {
      oCtx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);
      const screenshot = offscreen.toDataURL('image/jpeg', 0.7);
      const targetLetter = gameState.targetWord[gameState.currentLetterIndex];
      const gestureAnalysis = latestGestureAnalysisRef.current;
      const response = await recognizeLetter(screenshot, targetLetter, gestureAnalysis);

      setDebugInfo(response.debug);

      const { letter, confidence, message } = response.result;
      const normalizedLetter = normalizeLetter(letter);
      const normalizedTarget = normalizeLetter(targetLetter);
      const threshold = getThreshold(normalizedTarget);
      const exactMatch = normalizedLetter === normalizedTarget && confidence >= threshold;
      const approximateMatch = isApproximateUmlautMatch(
        normalizedTarget,
        normalizedLetter,
        confidence,
        gestureAnalysis
      );
      const acceptedLetter = exactMatch || approximateMatch ? normalizedTarget : normalizedLetter;

      setLastResult({ letter: acceptedLetter, message: message || '' });

      if (exactMatch || approximateMatch) {
        const nextIndex = gameState.currentLetterIndex + 1;
        setGameState((prev) => ({
          ...prev,
          currentLetterIndex: nextIndex,
          recognizedLetters: [...prev.recognizedLetters, normalizedTarget],
          score: prev.score + (nextIndex >= prev.targetWord.length ? 100 : 20),
          status: nextIndex >= prev.targetWord.length ? 'success' : prev.status
        }));
      }
    }

    setIsAnalyzing(false);
  };

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !containerRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    let camera: any = null;
    let hands: any = null;
    let active = true;

    const onResults = (results: any) => {
      if (!active) {
        return;
      }

      setLoading(false);
      canvas.width = containerRef.current?.clientWidth || 800;
      canvas.height = containerRef.current?.clientHeight || 600;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      latestGestureAnalysisRef.current = buildGestureAnalysis(results);

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        let allHandsStill = true;

        results.multiHandLandmarks.forEach((landmarks: Landmark[], index: number) => {
          if (window.drawConnectors && window.drawLandmarks) {
            window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, {
              color: index === 0 ? '#00FF00' : '#00AAFF',
              lineWidth: 2
            });
            window.drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });
          }

          const wrist = landmarks[0];
          const currentPos = { x: wrist.x, y: wrist.y };
          const lastPos = lastHandPosRef.current?.[index];

          if (!lastPos || distance(currentPos, lastPos) >= STILL_DISTANCE_THRESHOLD) {
            allHandsStill = false;
          }

          if (!lastHandPosRef.current) {
            lastHandPosRef.current = {};
          }
          lastHandPosRef.current[index] = currentPos;
        });

        if (allHandsStill) {
          if (!holdStartTimeRef.current) {
            holdStartTimeRef.current = performance.now();
          } else {
            const elapsed = performance.now() - holdStartTimeRef.current;
            const progress = Math.min(elapsed / HOLD_DURATION, 1);
            setHoldProgress(progress);

            if (progress >= 1 && !isAnalyzing && gameState.status === 'playing') {
              void handleCapture();
            }
          }
        } else {
          holdStartTimeRef.current = null;
          setHoldProgress(0);
        }
      } else {
        holdStartTimeRef.current = null;
        setHoldProgress(0);
        lastHandPosRef.current = null;
        latestGestureAnalysisRef.current = null;
      }

      ctx.restore();
    };

    if (window.Hands) {
      hands = new window.Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      hands.onResults(onResults);

      if (window.Camera) {
        camera = new window.Camera(video, {
          onFrame: async () => {
            if (videoRef.current && hands && active) {
              try {
                await hands.send({ image: videoRef.current });
              } catch (err) {
                console.warn('MediaPipe send error:', err);
              }
            }
          },
          width: 1280,
          height: 720,
        });

        camera.start();
      }
    }

    return () => {
      active = false;
      if (camera) {
        camera.stop();
      }
      if (hands) {
        try {
          hands.close();
        } catch (err) {
          console.warn('MediaPipe close error:', err);
        }
      }
    };
  }, [gameState.currentLetterIndex, gameState.status, gameState.targetWord, isAnalyzing]);

  const lastAcceptedLetter = gameState.targetWord[gameState.currentLetterIndex - 1];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black font-sans text-white">
      <div ref={containerRef} className="absolute inset-0 z-0">
        <video ref={videoRef} className="hidden" playsInline />
        <canvas ref={canvasRef} className="mirror h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />

        {loading && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80">
            <Loader2 className="mb-4 h-12 w-12 animate-spin text-emerald-500" />
            <p className="font-mono uppercase tracking-widest text-emerald-500">Goruntu sistemi baslatiliyor...</p>
          </div>
        )}

        <AnimatePresence>
          {isAnalyzing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 flex items-center justify-center bg-emerald-500/10 backdrop-blur-sm"
            >
              <div className="flex flex-col items-center">
                <BrainCircuit className="mb-4 h-16 w-16 animate-pulse text-emerald-400" />
                <p className="font-bold uppercase tracking-widest text-emerald-400">Gemini isareti analiz ediyor...</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-emerald-500" />
          <h1 className="text-xl font-black uppercase italic tracking-tighter drop-shadow-lg">Isaret ve Hecele</h1>
        </div>
        <div className="rounded-full border border-white/10 bg-black/40 px-4 py-2 backdrop-blur-md">
          <span className="font-mono text-sm font-bold text-emerald-500">PUAN: {gameState.score}</span>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center p-2 md:p-4">
        {gameState.status === 'playing' && holdProgress > 0 && (
          <div className="pointer-events-auto mb-2 h-1 w-48 overflow-hidden rounded-full border border-white/5 bg-white/20 backdrop-blur-md">
            <motion.div className="h-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: `${holdProgress * 100}%` }} />
          </div>
        )}

        <div className="pointer-events-auto w-full max-w-xl">
          {gameState.status === 'idle' ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-white/10 bg-black/40 p-4 text-center backdrop-blur-xl"
            >
              <h2 className="mb-2 text-lg font-bold">Yeteneklerini test etmeye hazir misin?</h2>
              <button
                onClick={startNewGame}
                className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white transition-all active:scale-95 hover:bg-emerald-500"
              >
                OYUNU BASLAT
              </button>
            </motion.div>
          ) : gameState.status === 'success' ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-2xl border border-white/10 bg-black/40 p-4 text-center backdrop-blur-xl"
            >
              <h2 className="mb-2 text-xl font-black uppercase tracking-tighter">Kelime tamamlandi!</h2>
              <button
                onClick={startNewGame}
                className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white transition-all hover:bg-emerald-500"
              >
                SIRADAKI KELIME
              </button>
            </motion.div>
          ) : (
            <div className="flex flex-col gap-2">
              <AnimatePresence>
                {lastResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`mx-auto flex items-center gap-2 rounded-xl border px-3 py-1.5 shadow-2xl backdrop-blur-xl ${
                      lastResult.letter === lastAcceptedLetter
                        ? 'border-emerald-500/30 bg-emerald-500/20 text-emerald-400'
                        : 'border-red-500/30 bg-red-500/20 text-red-400'
                    }`}
                  >
                    {lastResult.letter === lastAcceptedLetter ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <p className="text-[10px] font-bold">
                      {lastResult.letter === lastAcceptedLetter ? 'Dogru!' : `Algilanan: ${lastResult.letter || '?'}`}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/20 text-xl font-black text-emerald-500">
                      {gameState.targetWord[gameState.currentLetterIndex]}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {gameState.targetWord.split('').map((char, i) => (
                        <div
                          key={i}
                          className={`flex h-8 w-6 items-center justify-center rounded-md border text-xs font-black transition-all ${
                            i < gameState.currentLetterIndex
                              ? 'border-emerald-400 bg-emerald-500 text-white'
                              : i === gameState.currentLetterIndex
                                ? 'animate-pulse border-emerald-500 bg-white/10 text-emerald-500'
                                : 'border-white/10 bg-white/5 text-white/20'
                          }`}
                        >
                          {i < gameState.currentLetterIndex ? char : i === gameState.currentLetterIndex ? '?' : ''}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="hidden text-right sm:block">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-white/40">Siradaki</p>
                    <p className="text-[10px] font-bold">&quot;{gameState.targetWord[gameState.currentLetterIndex]}&quot;</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-4 left-6 z-30 hidden items-center gap-6 opacity-40 md:flex">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
          <Camera className="h-3 w-3" />
          <span>Goruntu aktif</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
          <Sparkles className="h-3 w-3" />
          <span>Gemini 3 Flash</span>
        </div>
      </div>
    </div>
  );
};

export default SignAndSpell;
