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

    const onResults = (results: any) => {
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
            if (videoRef.current && hands) await hands.send({ image: videoRef.current });
          },
          width: 1280,
          height: 720,
        });
        camera.start();
      }
    }

    return () => {
      if (camera) camera.stop();
      if (hands) hands.close();
    };
  }, [gameState.status, isAnalyzing]);

  return (
    <div className="flex flex-col md:flex-row w-full h-screen bg-[#0a0a0a] text-white overflow-hidden font-sans">
      {/* Left Side: Camera View */}
      <div ref={containerRef} className="relative flex-1 bg-black overflow-hidden">
        <video ref={videoRef} className="hidden" playsInline />
        <canvas ref={canvasRef} className="w-full h-full object-cover mirror" style={{ transform: 'scaleX(-1)' }} />
        
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-50">
            <Loader2 className="w-12 h-12 animate-spin text-emerald-500 mb-4" />
            <p className="text-emerald-500 font-mono tracking-widest uppercase">Görüntü Sistemi Başlatılıyor...</p>
          </div>
        )}

        {/* Hold Progress Bar */}
        {gameState.status === 'playing' && holdProgress > 0 && (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-64 h-2 bg-white/20 rounded-full overflow-hidden border border-white/10 backdrop-blur-md">
            <motion.div 
              className="h-full bg-emerald-500"
              initial={{ width: 0 }}
              animate={{ width: `${holdProgress * 100}%` }}
            />
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

      {/* Right Side: Game UI */}
      <div className="w-full md:w-[400px] bg-[#111] border-l border-white/10 flex flex-col p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <Sparkles className="text-emerald-500 w-6 h-6" />
            <h1 className="text-xl font-black tracking-tighter uppercase italic">İşaret ve Hecele</h1>
          </div>
          <div className="bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
            <span className="text-emerald-500 font-mono font-bold text-sm">PUAN: {gameState.score}</span>
          </div>
        </div>

        {gameState.status === 'idle' ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-emerald-500/20 rounded-3xl flex items-center justify-center mb-6 border border-emerald-500/30">
              <Play className="text-emerald-500 w-10 h-10 fill-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold mb-4">Yeteneklerini test etmeye hazır mısın?</h2>
            <p className="text-white/60 mb-8 leading-relaxed">
              Hedef kelimenin harflerini ellerinle işaret et. Yakalamak için işaretini sabit tut.
            </p>
            <button 
              onClick={startNewGame}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
            >
              OYUNU BAŞLAT
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="mb-8">
              <p className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Hedef Kelime</p>
              <div className="flex gap-2 flex-wrap">
                {gameState.targetWord.split('').map((char, i) => (
                  <div 
                    key={i}
                    className={`w-12 h-16 rounded-xl flex items-center justify-center text-2xl font-black border-2 transition-all ${
                      i < gameState.currentLetterIndex 
                        ? 'bg-emerald-500 border-emerald-400 text-white' 
                        : i === gameState.currentLetterIndex 
                          ? 'bg-white/5 border-emerald-500 text-emerald-500 animate-pulse' 
                          : 'bg-white/5 border-white/10 text-white/20'
                    }`}
                  >
                    {i < gameState.currentLetterIndex ? char : i === gameState.currentLetterIndex ? '?' : ''}
                  </div>
                ))}
              </div>
            </div>

            {gameState.status === 'playing' && (
              <div className="bg-white/5 rounded-2xl p-6 border border-white/10 mb-6">
                <p className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4">Sıradaki Harf</p>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center text-4xl font-black text-emerald-500 border border-emerald-500/30">
                    {gameState.targetWord[gameState.currentLetterIndex]}
                  </div>
                  <div>
                    <p className="font-bold">"{gameState.targetWord[gameState.currentLetterIndex]}" harfini işaret et</p>
                    <p className="text-sm text-white/40 italic">Yakalamak için elini sabit tut</p>
                  </div>
                </div>
              </div>
            )}

            {lastResult && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-4 rounded-xl border mb-6 flex items-start gap-3 ${
                  lastResult.letter === gameState.targetWord[gameState.currentLetterIndex - 1]
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}
              >
                {lastResult.letter === gameState.targetWord[gameState.currentLetterIndex - 1] 
                  ? <CheckCircle2 className="w-5 h-5 shrink-0" /> 
                  : <XCircle className="w-5 h-5 shrink-0" />
                }
                <div>
                  <p className="font-bold text-sm">
                    {lastResult.letter === gameState.targetWord[gameState.currentLetterIndex - 1] 
                      ? 'Doğru!' 
                      : `Algılanan: ${lastResult.letter || 'Bilinmiyor'}`
                    }
                  </p>
                  <p className="text-xs opacity-80">{lastResult.message}</p>
                </div>
              </motion.div>
            )}

            {gameState.status === 'success' && (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <Trophy className="w-16 h-16 text-yellow-500 mb-4" />
                <h2 className="text-2xl font-bold mb-2">Kelime Tamamlandı!</h2>
                <p className="text-white/60 mb-8">+100 Puan Kazanıldı</p>
                <button 
                  onClick={startNewGame}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all"
                >
                  SIRADAKİ KELİME
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-auto pt-6 border-t border-white/10">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2 text-white/40 text-xs font-bold uppercase tracking-tighter">
              <Camera className="w-4 h-4" />
              <span>Görüntü Aktif</span>
            </div>
            <div className="flex items-center gap-2 text-white/40 text-xs font-bold uppercase tracking-tighter">
              <Sparkles className="w-4 h-4" />
              <span>Gemini 3 Flash</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignAndSpell;
