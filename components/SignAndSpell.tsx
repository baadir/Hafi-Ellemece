import React, { useEffect, useRef, useState, useCallback } from 'react';
import { recognizeLetter } from '../services/geminiService';
import { GameState, DebugInfo } from '../types';
import { Loader2, Trophy, BrainCircuit, Play, CheckCircle2, XCircle, Camera, Keyboard, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const WORDS = ['MERHABA', 'İŞARET', 'TÜRKİYE', 'ELMA', 'KİTAP', 'GÜNEŞ', 'DENİZ', 'KALEM'];
const HOLD_DURATION = 1500; // ms to hold gesture

const SignAndSpell: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
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
  const [lastResult, setLastResult] = useState<{ letter: string, message: string } | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  const holdStartTimeRef = useRef<number | null>(null);
  const isStillRef = useRef<boolean>(false);
  const lastHandPosRef = useRef<{ x: number, y: number } | null>(null);

  const startNewGame = () => {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    setGameState({
      targetWord: word,
      currentLetterIndex: 0,
      recognizedLetters: [],
      score: gameState.score,
      status: 'playing'
    });
    setLastResult(null);
  };

  const handleCapture = async () => {
    if (!canvasRef.current || isAnalyzing) return;

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
      const screenshot = offscreen.toDataURL("image/jpeg", 0.7);
      
      const targetLetter = gameState.targetWord[gameState.currentLetterIndex];
      const response = await recognizeLetter(screenshot, targetLetter);
      
      setDebugInfo(response.debug);
      const { letter, confidence, message } = response.result;
      
      setLastResult({ letter, message: message || '' });

      const isSpecialChar = ['Ü', 'Ö', 'İ', 'Ç', 'Ş', 'Ğ'].includes(targetLetter);
      const threshold = isSpecialChar ? 0.4 : 0.6;

      if (letter === targetLetter && confidence > threshold) {
        const nextIndex = gameState.currentLetterIndex + 1;
        if (nextIndex >= gameState.targetWord.length) {
          setGameState(prev => ({
            ...prev,
            currentLetterIndex: nextIndex,
            recognizedLetters: [...prev.recognizedLetters, letter],
            score: prev.score + 100,
            status: 'success'
          }));
        } else {
          setGameState(prev => ({
            ...prev,
            currentLetterIndex: nextIndex,
            recognizedLetters: [...prev.recognizedLetters, letter],
            score: prev.score + 20
          }));
        }
      }
    }
    setIsAnalyzing(false);
  };

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !containerRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let camera: any = null;
    let hands: any = null;

    let active = true;

    const onResults = (results: any) => {
      if (!active) return;
      setLoading(false);
      
      canvas.width = containerRef.current?.clientWidth || 800;
      canvas.height = containerRef.current?.clientHeight || 600;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        let allHandsStill = true;
        
        results.multiHandLandmarks.forEach((landmarks: any, index: number) => {
          // Draw landmarks
          if (window.drawConnectors && window.drawLandmarks) {
            window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, { color: index === 0 ? '#00FF00' : '#00AAFF', lineWidth: 2 });
            window.drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });
          }

          // Check if this hand is still
          const wrist = landmarks[0];
          const currentPos = { x: wrist.x, y: wrist.y };
          const lastPos = lastHandPosRef.current?.[index];
          
          if (lastPos) {
            const dist = Math.sqrt(
              Math.pow(currentPos.x - lastPos.x, 2) + 
              Math.pow(currentPos.y - lastPos.y, 2)
            );
            
            if (dist >= 0.02) {
              allHandsStill = false;
            }
          } else {
            allHandsStill = false;
          }

          // Update last pos for this hand
          if (!lastHandPosRef.current) lastHandPosRef.current = {};
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
              handleCapture();
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
                console.warn("MediaPipe send error:", err);
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
      if (camera) camera.stop();
      if (hands) {
        try {
          hands.close();
        } catch (err) {
          console.warn("MediaPipe close error:", err);
        }
      }
    };
  }, [gameState.status, isAnalyzing]);

  return (
    <div className="relative w-full h-screen bg-black text-white overflow-hidden font-sans">
      {/* Full Screen Camera View */}
      <div ref={containerRef} className="absolute inset-0 z-0">
        <video ref={videoRef} className="hidden" playsInline />
        <canvas ref={canvasRef} className="w-full h-full object-cover mirror" style={{ transform: 'scaleX(-1)' }} />
        
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-50">
            <Loader2 className="w-12 h-12 animate-spin text-emerald-500 mb-4" />
            <p className="text-emerald-500 font-mono tracking-widest uppercase">Görüntü Sistemi Başlatılıyor...</p>
          </div>
        )}

        {/* Analysis Overlay */}
        <AnimatePresence>
          {isAnalyzing && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-emerald-500/10 backdrop-blur-sm z-40"
            >
              <div className="flex flex-col items-center">
                <BrainCircuit className="w-16 h-16 text-emerald-400 animate-pulse mb-4" />
                <p className="text-emerald-400 font-bold tracking-widest uppercase">Gemini İşareti Analiz Ediyor...</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Top Bar: Score & Title */}
      <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between z-30 bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-2">
          <Sparkles className="text-emerald-500 w-6 h-6" />
          <h1 className="text-xl font-black tracking-tighter uppercase italic drop-shadow-lg">İşaret ve Hecele</h1>
        </div>
        <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
          <span className="text-emerald-500 font-mono font-bold text-sm">PUAN: {gameState.score}</span>
        </div>
      </div>

      {/* Bottom UI Overlay */}
      <div className="absolute bottom-0 left-0 right-0 z-30 p-2 md:p-4 flex flex-col items-center pointer-events-none">
        
        {/* Hold Progress Bar */}
        {gameState.status === 'playing' && holdProgress > 0 && (
          <div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden border border-white/5 backdrop-blur-md mb-2 pointer-events-auto">
            <motion.div 
              className="h-full bg-emerald-500"
              initial={{ width: 0 }}
              animate={{ width: `${holdProgress * 100}%` }}
            />
          </div>
        )}

        <div className="w-full max-w-xl pointer-events-auto">
          {gameState.status === 'idle' ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-4 text-center"
            >
              <h2 className="text-lg font-bold mb-2">Yeteneklerini test etmeye hazır mısın?</h2>
              <button 
                onClick={startNewGame}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all active:scale-95 text-sm"
              >
                OYUNU BAŞLAT
              </button>
            </motion.div>
          ) : gameState.status === 'success' ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-4 text-center"
            >
              <h2 className="text-xl font-black mb-2 uppercase tracking-tighter">Kelime Tamamlandı!</h2>
              <button 
                onClick={startNewGame}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all text-sm"
              >
                SIRADAKİ KELİME
              </button>
            </motion.div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Last Result Toast (Compact) */}
              <AnimatePresence>
                {lastResult && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`px-3 py-1.5 rounded-xl border backdrop-blur-xl flex items-center gap-2 shadow-2xl mx-auto ${
                      lastResult.letter === gameState.targetWord[gameState.currentLetterIndex - 1]
                        ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                        : 'bg-red-500/20 border-red-500/30 text-red-400'
                    }`}
                  >
                    {lastResult.letter === gameState.targetWord[gameState.currentLetterIndex - 1] 
                      ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> 
                      : <XCircle className="w-3.5 h-3.5 shrink-0" />
                    }
                    <p className="font-bold text-[10px]">
                      {lastResult.letter === gameState.targetWord[gameState.currentLetterIndex - 1] 
                        ? 'Doğru!' 
                        : `Algılanan: ${lastResult.letter || '?'}`
                      }
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Main Game Controls (Compact) */}
              <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center text-xl font-black text-emerald-500 border border-emerald-500/30 shrink-0">
                      {gameState.targetWord[gameState.currentLetterIndex]}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {gameState.targetWord.split('').map((char, i) => (
                        <div 
                          key={i}
                          className={`w-6 h-8 rounded-md flex items-center justify-center text-xs font-black border transition-all ${
                            i < gameState.currentLetterIndex 
                              ? 'bg-emerald-500 border-emerald-400 text-white' 
                              : i === gameState.currentLetterIndex 
                                ? 'bg-white/10 border-emerald-500 text-emerald-500 animate-pulse' 
                                : 'bg-white/5 border-white/10 text-white/20'
                          }`}
                        >
                          {i < gameState.currentLetterIndex ? char : i === gameState.currentLetterIndex ? '?' : ''}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="text-right hidden sm:block">
                    <p className="text-[8px] font-bold text-white/40 uppercase tracking-widest">Sıradaki</p>
                    <p className="font-bold text-[10px]">"{gameState.targetWord[gameState.currentLetterIndex]}"</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="absolute bottom-4 left-6 hidden md:flex items-center gap-6 z-30 opacity-40">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
          <Camera className="w-3 h-3" />
          <span>Görüntü Aktif</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
          <Sparkles className="w-3 h-3" />
          <span>Gemini 3 Flash</span>
        </div>
      </div>
    </div>
  );
};

export default SignAndSpell;
