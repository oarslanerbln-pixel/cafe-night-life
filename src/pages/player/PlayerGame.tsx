import { useState, useEffect, useRef, useCallback } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { NeonIcon } from '../../components/NeonIcon';
import { KineticSpark } from '../../components/KineticSpark';

type RoomStatus = 'lobby' | 'playing' | 'review' | 'finished' | 'closed';

export function PlayerGame() {
    const [roomStatus, setRoomStatus] = useState<RoomStatus>('lobby');
    const [categories, setCategories] = useState<string[]>([]);
    const [activeLetter, setActiveLetter] = useState<string>('?');
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [isLocked, setIsLocked] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [timerSetting, setTimerSetting] = useState<number>(60);
    const [currentRound, setCurrentRound] = useState(0);
    const [totalScore, setTotalScore] = useState(0);
    const [roundPoints, setRoundPoints] = useState<number | null>(null);
    const [showIntro, setShowIntro] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setShowIntro(false), 4000);
        return () => clearTimeout(timer);
    }, []);

    const playerName = localStorage.getItem('cafe_game_playerName') || 'Oyuncu';
    const roomId = localStorage.getItem('cafe_game_roomId');
    const playerId = localStorage.getItem('cafe_game_playerId');
    const hasSubmitted = useRef(false);
    // Realtime callbacks outlive renders, so they read the latest values through refs
    const roomStatusRef = useRef<RoomStatus>('lobby');
    const totalScoreRef = useRef(0);

    const submitAnswers = useCallback(async (isEarly: boolean = false) => {
        if (!roomId || !playerId || hasSubmitted.current) return;
        hasSubmitted.current = true;
        setSubmitStatus('submitting');
        setIsLocked(true); // Lock inputs if manually early submitted

        // The answers table is keyed by letter only; _round lets the host tell rounds apart
        // when the same letter is drawn again.
        const finalData = { ...answers, _earlySubmit: isEarly ? 'true' : 'false', _round: String(currentRound) };

        const { error } = await supabase.from('answers').insert([
            {
                room_id: roomId,
                player_id: playerId,
                round_letter: activeLetter,
                data: finalData,
                is_submitted: true,
            }
        ]);

        if (error) {
            console.error('Answer submit error:', error);
        }
        setSubmitStatus(error ? 'error' : 'submitted');
    }, [roomId, playerId, answers, activeLetter, currentRound]);

    // The realtime callback below outlives renders; this keeps it pointed at the submit that sees the typed answers
    const submitRef = useRef(submitAnswers);
    useEffect(() => {
        submitRef.current = submitAnswers;
    }, [submitAnswers]);

    useEffect(() => {
        if (!roomId) return;

        const emptyAnswers = (cats: string[]) => Object.fromEntries(cats.map(cat => [cat, '']));

        const fetchRoom = async () => {
            const { data } = await supabase.from('rooms').select('*').eq('id', roomId).single();
            if (data) {
                roomStatusRef.current = data.status;
                setRoomStatus(data.status);
                setCategories(data.categories || []);
                setTimerSetting(data.timer_setting || 60);
                setCurrentRound(data.current_round || 0);
                if (data.active_letter) setActiveLetter(data.active_letter);
                if (data.time_left !== undefined) setTimeLeft(data.time_left);
                setAnswers(emptyAnswers(data.categories || []));
            }
        };

        fetchRoom();

        const channel = supabase
            .channel(`player-room-${roomId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
                (payload) => {
                    const room = payload.new;

                    // Reset on new round starting
                    if (room.status === 'playing' && roomStatusRef.current !== 'playing') {
                        setIsLocked(false);
                        hasSubmitted.current = false;
                        setSubmitStatus('idle');
                        setRoundPoints(null);
                        setAnswers(emptyAnswers(room.categories || []));
                    }

                    roomStatusRef.current = room.status;
                    setRoomStatus(room.status);
                    if (room.active_letter) setActiveLetter(room.active_letter);
                    if (room.categories) setCategories(room.categories);
                    if (room.time_left !== undefined) setTimeLeft(room.time_left);
                    if (room.timer_setting) setTimerSetting(room.timer_setting);
                    if (room.current_round) setCurrentRound(room.current_round);

                    if (room.status === 'review' || room.status === 'finished') {
                        setIsLocked(true);
                        // Round ended (timer ran out / host closed it) before an early send: submit what is typed.
                        // No-op when the player already sent early.
                        submitRef.current(false);
                    }
                }
            )
            .subscribe();

        // Separate subscription for current player's score
        let playerChannel: RealtimeChannel | undefined;
        if (playerId) {
            const fetchPlayer = async () => {
                const { data } = await supabase.from('players').select('total_score').eq('id', playerId).single();
                if (data) {
                    totalScoreRef.current = data.total_score;
                    setTotalScore(data.total_score);
                }
            };
            fetchPlayer();

            playerChannel = supabase
                .channel(`player-self-${playerId}`)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players', filter: `id=eq.${playerId}` },
                    (payload) => {
                        const newScore = payload.new.total_score;
                        setRoundPoints(newScore - totalScoreRef.current);
                        totalScoreRef.current = newScore;
                        setTotalScore(newScore);
                    }
                )
                .subscribe();
        }

        return () => {
            supabase.removeChannel(channel);
            if (playerChannel) supabase.removeChannel(playerChannel);
        };
    }, [roomId, playerId]);

    const handleInputChange = (category: string, value: string) => {
        if (isLocked) return;
        setAnswers(prev => ({ ...prev, [category]: value }));
    };

    const anyCategoryFilled = categories.length > 0 && categories.some(cat => answers[cat] && answers[cat].trim() !== '');

    const handleEarlySubmit = () => {
        if (anyCategoryFilled && !isLocked) {
            submitAnswers(true);
        }
    };

    return (
        <div className="flex-1 flex flex-col p-4 min-h-[100dvh] relative z-10 bg-seljuk-pattern overflow-hidden">
            <AnimatePresence mode="wait">
                {showIntro ? (
                    <motion.div
                        key="intro"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, scale: 1.2, filter: 'blur(40px)' }}
                        transition={{ duration: 1.5, ease: "circIn" }}
                        className="bg-black fixed inset-0 z-[100] flex items-center justify-center overflow-hidden noise-suppression"
                    >
                        <div className="relative w-full max-w-7xl flex flex-col items-center justify-center">
                            <KineticSpark delay={0.5} showTagline tagline="Kadim Ateş • Modern Ruh" />
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: [0, 0.1, 0.05, 0.15] }}
                                transition={{ delay: 2, duration: 4, repeat: Infinity, repeatType: "mirror" }}
                                className="absolute inset-0 bg-alaz-orange/10 blur-[150px] -z-10 rounded-full"
                            />
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="content"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1 }}
                        className="flex-1 flex flex-col h-full"
                    >
                        <header className="flex justify-between items-center py-4 px-6 glass-panel-alaz border-white/10 mb-6 mt-2">
                <div className="flex items-center gap-3">
                    <NeonIcon type="users" color="orange" className="w-6 h-6" />
                    <div className="font-black text-white tracking-tight uppercase text-glow-alaz">{playerName}</div>
                </div>
                <div className="flex flex-col items-end">
                    <div className={`text-[10px] px-3 py-1.5 rounded-full font-black tracking-widest uppercase border ${roomStatus === 'playing' ? 'bg-alaz-orange/10 text-alaz-orange border-alaz-orange/30' :
                        roomStatus === 'review' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                            roomStatus === 'finished' ? 'bg-neon-blue/10 text-neon-blue border-neon-blue/30' :
                                'bg-white/5 text-white/40 border-white/10'
                        }`}>
                        {roomStatus === 'lobby' && 'BEKLEMEDE'}
                        {roomStatus === 'playing' && `CANLI - TUR ${currentRound}`}
                        {roomStatus === 'review' && 'SİSTEM HESAPLIYOR'}
                        {roomStatus === 'finished' && 'OYUN BİTTİ!'}
                    </div>
                    {totalScore > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">TOPLAM:</span>
                            <span className="text-sm font-black text-alaz-orange">{totalScore}</span>
                        </div>
                    )}
                </div>
            </header>

            {roomStatus === 'playing' && timeLeft !== null && (
                <div className="w-full mb-6">
                    <div className="flex justify-between text-xs font-black uppercase tracking-widest mb-2 px-1">
                        <span className="text-gray-400">Kalan Süre</span>
                        <span className={timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-alaz-orange'}>{timeLeft}s</span>
                    </div>
                    <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                            className={`h-full ${timeLeft <= 10 ? 'bg-red-500 shadow-[0_0_10px_red]' : 'bg-alaz-orange'}`}
                            initial={{ width: '100%' }}
                            animate={{ width: `${(timeLeft / timerSetting) * 100}%` }}
                            transition={{ duration: 1, ease: 'linear' }}
                        />
                    </div>
                </div>
            )}

            <div className="flex-1 flex flex-col">
                <AnimatePresence mode="wait">
                    {roomStatus === 'lobby' && (
                        <motion.div key="lobby" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -20 }} className="flex-1 flex flex-col items-center justify-center text-center space-y-10">
                            <div className="relative w-full max-w-xs mx-auto opacity-80 scale-75">
                                <KineticSpark
                        fontSizeAlaz="text-[6rem] md:text-[5rem]"
                        fontSizeNeon="text-[5rem] md:text-[4rem]"
                        delay={0.1}
                    />
                                <div className="absolute inset-0 bg-alaz-orange/5 blur-3xl rounded-full -z-10 animate-pulse" />
                            </div>
                            <div className="space-y-4">
                                <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase text-glow-alaz">ATEŞE HAZIR MISIN?</h2>
                                <p className="text-gray-400 text-xs max-w-[280px] mx-auto leading-relaxed font-medium">Gözler TV ekranında! Kadim ateş parladığında savaş başlayacak.</p>
                            </div>
                        </motion.div>
                    )}

                    {roomStatus === 'playing' && (
                        <motion.div key="playing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full space-y-6 pb-24">
                            <div className="flex items-center gap-6 glass-panel-alaz p-5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-alaz-orange/5 blur-2xl -mr-12 -mt-12" />
                                <div className="w-20 h-20 rounded-2xl bg-white/5 border-2 border-alaz-orange shadow-[0_0_20px_rgba(255,77,0,0.2)] flex items-center justify-center animate-beat">
                                    <span className="text-5xl font-black text-white text-glow-ultra-alaz">{activeLetter}</span>
                                </div>
                                <div className="text-left flex-1">
                                    <h2 className="text-xl font-black text-white italic tracking-tight uppercase">Sıradaki Harf</h2>
                                    <p className="text-alaz-orange text-[9px] font-black tracking-[0.2em] opacity-80 uppercase">ATEŞİ KÖRÜKLE!</p>
                                </div>
                            </div>

                            <div className="grid gap-4">
                                {categories.map((category, idx) => (
                                    <motion.div key={`${currentRound}-${category}`} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.05 }} className="relative group">
                                        <div className="absolute left-6 top-3 z-10 flex items-center gap-2">
                                            <NeonIcon type="lightbulb" color="orange" className="w-3 h-3 opacity-40" />
                                            <label className="text-[10px] text-alaz-orange font-black uppercase tracking-[0.2em]">{category}</label>
                                        </div>
                                        {(() => {
                                            const val = answers[category] || '';
                                            const isWrongLetter = val.trim() !== '' && !val.trim().toLowerCase().startsWith(activeLetter.toLowerCase());
                                            return (
                                                <>
                                                    <input
                                                        type="text"
                                                        value={val}
                                                        onChange={(e) => handleInputChange(category, e.target.value)}
                                                        disabled={isLocked}
                                                        autoComplete="off"
                                                        className={`w-full bg-white/5 border rounded-2xl px-6 pt-10 pb-5 focus:outline-none transition-all text-white text-xl font-bold 
                                                            ${isLocked ? 'border-red-500/20 opacity-40 cursor-not-allowed' : 
                                                              isWrongLetter ? 'border-red-500/50 bg-red-500/5 shadow-[0_0_15px_rgba(239,68,68,0.1)]' : 
                                                              'border-white/10 focus:border-alaz-orange focus:shadow-[0_0_20px_rgba(255,77,0,0.1)]'}`}
                                                        placeholder="..."
                                                    />
                                                    {isWrongLetter && !isLocked && (
                                                        <motion.span 
                                                            initial={{ opacity: 0, scale: 0.8 }}
                                                            animate={{ opacity: 1, scale: 1 }}
                                                            className="absolute right-4 bottom-2 text-[8px] font-black text-red-500 uppercase tracking-widest"
                                                        >
                                                            Yanlış Harf! "{activeLetter}" ile başlamalı
                                                        </motion.span>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </motion.div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {/* Fixed Early Action Footer */}
                    {roomStatus === 'playing' && (
                        <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="fixed bottom-0 left-0 w-full p-4 z-50 bg-gradient-to-t from-[#0a0f16] via-[#0a0f16]/90 to-transparent pt-12">
                            <button
                                onClick={handleEarlySubmit}
                                disabled={isLocked || !anyCategoryFilled}
                                className={`w-full py-5 rounded-2xl font-black text-lg transition-all flex justify-center items-center gap-2 ${isLocked ? 'bg-gray-800 text-gray-500 cursor-not-allowed' :
                                    !anyCategoryFilled ? 'bg-white/10 text-white/30 cursor-not-allowed border border-white/5' :
                                        'bg-neon-blue text-black hover:bg-white shadow-[0_0_30px_rgba(0,255,255,0.4)] hover:shadow-[0_0_40px_rgba(255,255,255,0.6)] animate-pulse border-2 border-neon-blue'
                                    }`}
                            >
                                <NeonIcon type="rocket" color={anyCategoryFilled && !isLocked ? 'black' : 'gray'} className="w-5 h-5" />
                                {isLocked ? (submitStatus === 'submitted' ? 'ATEŞLENDİ!' : 'BEKLENİYOR...') : !anyCategoryFilled ? 'EN AZ BİR CEVAP YAZ' : 'HIZ BONUSU AL! (ERKEN GÖNDER)'}
                            </button>
                        </motion.div>
                    )}

                    {(roomStatus === 'review' || roomStatus === 'finished') && (
                        <motion.div key="review" initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 1, scale: 1 }} className="flex-1 flex flex-col items-center justify-center text-center space-y-10">
                            <div className="relative">
                                <div className={`w-32 h-32 rounded-3xl glass-panel-alaz flex items-center justify-center mx-auto ${roomStatus === 'finished' ? 'border-neon-blue bg-neon-blue/20' : 'border-alaz-orange bg-alaz-orange/20'}`}>
                                    <NeonIcon type={roomStatus === 'finished' ? "crown" : "settings"} color={roomStatus === 'finished' ? "blue" : "orange"} className="w-16 h-16 animate-pulse opacity-80" />
                                </div>
                            </div>
                            <div className="space-y-4">
                                <h2 className={`text-5xl font-black italic tracking-tighter uppercase ${roomStatus === 'finished' ? 'text-glow-blue text-neon-blue' : 'text-glow-alaz text-alaz-orange animate-glitch'}`}>
                                    {roomStatus === 'finished' ? 'OYUN BİTTİ!' : 'TUR BİTTİ!'}
                                </h2>
                                <div className="space-y-1">
                                    <p className="text-gray-400 text-sm font-medium">
                                        {submitStatus === 'submitting' && 'Cevapların şehir merkezine taşınıyor...'}
                                        {submitStatus === 'submitted' && 'Cevapların alındı! ✅ Puanlar TV ekranında.'}
                                        {submitStatus === 'error' && 'Cevapların gönderilemedi ❌ Bağlantını kontrol et.'}
                                        {submitStatus === 'idle' && (roomStatus === 'finished' ? 'Final tablosu hazır' : 'Sistem puanlamayı yapıyor...')}
                                    </p>
                                    {roundPoints !== null && roundPoints > 0 && (
                                        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-2xl font-black text-green-400 tracking-widest uppercase">
                                            BU TUR: +{roundPoints} PUAN
                                        </motion.div>
                                    )}
                                </div>
                            </div>

                            <div className="w-full max-w-sm grid grid-cols-2 gap-3 mt-4">
                                {categories.map(cat => (
                                    <div key={cat} className="bg-white/5 rounded-2xl p-4 border border-white/10 flex flex-col items-center">
                                        <span className="text-[8px] text-gray-500 uppercase font-black tracking-widest mb-1">{cat}</span>
                                        <span className={`text-sm font-bold truncate w-full ${answers[cat] ? 'text-white' : 'text-red-400 opacity-50'}`}>
                                            {answers[cat] || '—'}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {roomStatus === 'finished' && (
                                <div className="mt-8">
                                    <button onClick={() => window.location.href = '/'} className="px-8 py-4 bg-white/10 border border-white/20 text-white font-bold rounded-2xl hover:bg-white/20 transition-all">
                                        ANA SAYFAYA DÖN
                                    </button>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    )}
</AnimatePresence>
</div>
);
}
