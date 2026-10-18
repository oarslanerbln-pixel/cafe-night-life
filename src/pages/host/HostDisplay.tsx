import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ParticleBackground } from '../../components/ParticleBackground';
import { NeonIcon } from '../../components/NeonIcon';
import { KineticSpark } from '../../components/KineticSpark';
import { QRCodeSVG } from 'qrcode.react';

type Room = {
    id: string;
    code: string;
    status: 'lobby' | 'playing' | 'review' | 'closed' | 'finished';
    categories: string[];
    timer_setting: number;
    total_rounds: number;
    current_round: number;
    active_letter?: string;
    time_left?: number;
};

type RoundResultInfo = {
    playerId: string;
    name: string;
    roundScore: number;
    totalScore: number;
    answers: Record<string, { value: string; isUnique: boolean; points: number; isValid: boolean }>;
    earlyBonus: boolean;
};

export function HostDisplay() {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('roomId');

    const [room, setRoom] = useState<Room | null>(null);
    const [gameState, setGameState] = useState<'intro' | 'lobby' | 'countdown' | 'playing' | 'review' | 'finished' | 'closed'>('intro');
    const [timeLeft, setTimeLeft] = useState(60);
    const [currentLetter, setCurrentLetter] = useState('?');
    const [players, setPlayers] = useState<{ id: string; name: string; total_score: number }[]>([]);
    const [countdownNumber, setCountdownNumber] = useState(3);
    const [roundResults, setRoundResults] = useState<RoundResultInfo[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Stats for Podium Badges
    const [playerStats, setPlayerStats] = useState<Record<string, { uniqueCount: number; earlyCount: number; blankCount: number }>>({});

    useEffect(() => {
        if (gameState === 'intro') {
            const timer = setTimeout(() => setGameState('lobby'), 4000);
            return () => clearTimeout(timer);
        }
    }, [gameState]);

    useEffect(() => {
        if (!roomId) return;

        const fetchPlayers = async () => {
            const { data } = await supabase.from('players').select('id, name, total_score').eq('room_id', roomId);
            if (data) setPlayers(data);
        };

        fetchPlayers();

        const playerChannel = supabase
            .channel(`room-players-${roomId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
                (payload) => {
                    const newPlayer = payload.new as { id: string; name: string; total_score: number };
                    setPlayers(prev => [...prev, newPlayer]);
                }
            )
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
                (payload) => {
                    const updated = payload.new as { id: string; name: string; total_score: number };
                    setPlayers(prev => prev.map(p => p.id === updated.id ? updated : p));
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(playerChannel); };
    }, [roomId]);

    useEffect(() => {
        if (!roomId) return;

        const fetchRoom = async () => {
            const { data, error } = await supabase.from('rooms').select('*').eq('id', roomId).single();
            if (data) {
                setRoom({ ...data, total_rounds: data.total_rounds || 3, current_round: data.current_round || 0 });
                if (gameState !== 'intro') setGameState(data.status);
                setTimeLeft(data.timer_setting);
                if (data.active_letter) setCurrentLetter(data.active_letter);
            } else if (error) {
                console.error("Hata:", error);
            }
        };

        fetchRoom();

        const subscription = supabase
            .channel(`room-${roomId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
                (payload) => {
                    const updatedRoom = payload.new as Room;
                    setRoom({ ...updatedRoom, total_rounds: updatedRoom.total_rounds || 3, current_round: updatedRoom.current_round || 0 });
                    if (gameState !== 'intro') setGameState(updatedRoom.status);
                    if (updatedRoom.active_letter) setCurrentLetter(updatedRoom.active_letter);
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(subscription); };
    }, [roomId, gameState]);

    const endRound = async () => {
        if (!roomId || !room) return;
        setGameState('review');
        setIsAnalyzing(true);

        await supabase.from('rooms').update({ status: 'review' }).eq('id', roomId);
        // Brief artificial delay for "analysis" feel
        await new Promise(resolve => setTimeout(resolve, 2500));

        const letterToQuery = room.active_letter || currentLetter;
        const normalizedLetter = letterToQuery.toLowerCase();

        const { data: fetchedAnswers } = await supabase
            .from('answers')
            .select('player_id, data, created_at')
            .eq('room_id', roomId)
            .eq('round_letter', letterToQuery)
            .order('created_at', { ascending: true });

        // Rows are keyed by letter only, so a letter drawn again (another round or "Yeni Oyun")
        // would pull in old answers. Players tag each row with its round; untagged rows are legacy.
        const roundAnswersArray = fetchedAnswers?.filter(a => {
            const round = (a.data as Record<string, string>)._round;
            return round === undefined || round === String(room.current_round);
        });

        if (!roundAnswersArray || roundAnswersArray.length === 0) {
            console.log("Cevap bulunamadı. Sorgu harfi:", letterToQuery);
            setIsAnalyzing(false);
            return;
        }

        // Find uniqueness per category
        const categoryCounts: Record<string, Record<string, number>> = {};
        (room.categories || []).forEach(cat => categoryCounts[cat] = {});

        roundAnswersArray.forEach(answer => {
            const ansData = answer.data as Record<string, string>;
            (room.categories || []).forEach(cat => {
                const valRaw = ansData[cat] || '';
                const val = valRaw.trim().toLowerCase();
                if (val) {
                    // Pre-filter: Must start with the correct letter
                    // Turkish character handling could be added here if needed (e.g., i/İ)
                    if (val.startsWith(normalizedLetter)) {
                        categoryCounts[cat][val] = (categoryCounts[cat][val] || 0) + 1;
                    }
                }
            });
        });

        // Find earliest completer (Speed bonus)
        let earliestPlayerId: string | null = null;
        for (const answer of roundAnswersArray) {
            const ansData = answer.data as Record<string, string>;
            if (ansData['_earlySubmit'] === 'true') {
                earliestPlayerId = answer.player_id;
                break;
            }
        }

        const currentPlayers = [...players];
        const newRoundResults: RoundResultInfo[] = [];

        for (const answer of roundAnswersArray) {
            const ansData = answer.data as Record<string, string>;
            let roundScore = 0;
            const answersBreakdown: Record<string, { value: string; isUnique: boolean; points: number; isValid: boolean }> = {};

            const playerInfo = currentPlayers.find(p => p.id === answer.player_id);
            if (!playerInfo) continue;

            (room.categories || []).forEach(cat => {
                const valRaw = ansData[cat] || '';
                const val = valRaw.trim().toLowerCase();
                let isUnique = false;
                let pts = 0;
                let isValid = false;

                if (val) {
                    // Check first letter
                    if (val.startsWith(normalizedLetter)) {
                        isValid = true;
                        if (categoryCounts[cat][val] === 1) {
                            isUnique = true;
                            pts = 20;
                        } else {
                            pts = 10;
                        }
                    } else {
                        isValid = false;
                        pts = 0;
                    }
                }

                roundScore += pts;
                answersBreakdown[cat] = { value: valRaw, isUnique, points: pts, isValid };
            });

            const gotEarlyBonus = answer.player_id === earliestPlayerId;
            if (gotEarlyBonus) roundScore += 15;

            newRoundResults.push({
                playerId: playerInfo.id,
                name: playerInfo.name,
                roundScore,
                totalScore: playerInfo.total_score + roundScore,
                answers: answersBreakdown,
                earlyBonus: gotEarlyBonus
            });

            // Update local statistics increments
            const currentStats = playerStats[playerInfo.id] || { uniqueCount: 0, earlyCount: 0, blankCount: 0 };
            const newStats = { ...currentStats };
            if (gotEarlyBonus) newStats.earlyCount++;

            (room.categories || []).forEach(cat => {
                const ans = answersBreakdown[cat];
                if (!ans.value) {
                    newStats.blankCount++;
                } else if (ans.isUnique && ans.isValid) {
                    newStats.uniqueCount++;
                }
            });

            setPlayerStats(prev => ({
                ...prev,
                [playerInfo.id]: newStats
            }));
        }

        setRoundResults(newRoundResults.sort((a, b) => b.totalScore - a.totalScore));
        setIsAnalyzing(false);
    };

    const resetGame = async () => {
        if (!roomId) return;

        // Reset player scores and stats
        await supabase.from('players').update({ total_score: 0 }).eq('room_id', roomId);
        setPlayerStats({});
        setRoundResults([]);

        // Reset room
        await supabase.from('rooms').update({
            status: 'lobby',
            current_round: 0,
            active_letter: '?'
        }).eq('id', roomId);

        setGameState('lobby');
    };

    const startGame = async () => {
        if (!roomId || !room) return;

        const letters = "ABCDEFGHIJKLMNOPRSTUVYZ";
        const randomLetter = letters[Math.floor(Math.random() * letters.length)];
        setCurrentLetter(randomLetter);

        setGameState('countdown');
        setCountdownNumber(3);
        await new Promise(r => setTimeout(r, 1000));
        setCountdownNumber(2);
        await new Promise(r => setTimeout(r, 1000));
        setCountdownNumber(1);
        await new Promise(r => setTimeout(r, 1000));

        const nextRound = (room.current_round || 0) + 1;

        await supabase.from('rooms').update({
            status: 'playing',
            active_letter: randomLetter,
            current_round: nextRound,
            time_left: room.timer_setting
        }).eq('id', roomId);

        setTimeLeft(room.timer_setting);
        setGameState('playing');
    };

    const toggleAnswerValidity = (playerId: string, category: string) => {
        setRoundResults(prev => prev.map(res => {
            if (res.playerId !== playerId) return res;

            const targetAns = res.answers[category];
            const wasValid = targetAns.isValid;
            const newValid = !wasValid;
            
            // Recalculate uniqueness points if toggled to valid
            // In a simple system, we just toggle 0 vs (10/20)
            // But to be precise, we stick to the original assigned points if it was unique
            const originalPoints = targetAns.points;
            let newPoints = 0;

            if (newValid) {
                // Determine what the points SHOULD have been
                // We'll simplify: if it was unique, 20, else 10.
                // We already have isUnique stored.
                newPoints = targetAns.isUnique ? 20 : 10;
            }

            const pointDiff = newPoints - (wasValid ? originalPoints : 0);

            return {
                ...res,
                roundScore: res.roundScore + pointDiff,
                totalScore: res.totalScore + pointDiff,
                answers: {
                    ...res.answers,
                    [category]: { ...targetAns, isValid: newValid, points: newPoints }
                }
            };
        }));
    };

    const nextStep = async () => {
        if (!roomId || !room) return;

        // --- BULK SYNC TO DATABASE ---
        // Now that host finished reviewing, we commit the results to the players table
        for (const res of roundResults) {
            await supabase.from('players').update({ total_score: res.totalScore }).eq('id', res.playerId);
        }

        // Refresh player list from DB for visual consistency
        const { data: updatedPlayers } = await supabase.from('players').select('id, name, total_score').eq('room_id', roomId);
        if (updatedPlayers) setPlayers(updatedPlayers);

        if (room.current_round >= room.total_rounds) {
            // Game Finish
            await supabase.from('rooms').update({ status: 'finished' }).eq('id', roomId);
            setGameState('finished');
        } else {
            // Start Next Round automatically
            startGame();
        }
    };

    // Timer simulation & DB sync for clients
    useEffect(() => {
        if (gameState !== 'playing' || timeLeft <= 0) return;

        const timer = setTimeout(() => {
            const newTime = timeLeft - 1;
            setTimeLeft(newTime);
            // No time_left=0 write: the status change to 'review' ends the round, and an extra
            // UPDATE still carrying status 'playing' would bounce the host back into 'playing'.
            if (newTime > 0 && newTime % 5 === 0 && roomId) {
                supabase.from('rooms').update({ time_left: newTime }).eq('id', roomId).then();
            }
            if (newTime === 0) endRound();
        }, 1000);
        return () => clearTimeout(timer);
    }, [gameState, timeLeft]);

    return (
        <div className={`flex-1 flex flex-col p-8 h-screen overflow-hidden ${gameState === 'playing' && timeLeft <= 10 ? 'animate-shake' : ''}`}>
            <ParticleBackground speedMultiplier={gameState === 'playing' && timeLeft <= 10 ? 5 : 1} />
            {gameState === 'playing' && timeLeft <= 10 && <div className="danger-overlay" />}

            {gameState !== 'intro' && (
                <header className="flex justify-between items-center mb-8 relative z-20 bg-black/40 p-4 rounded-3xl border border-white/10 backdrop-blur-md">
                    <h1 className="text-3xl font-black text-glow-alaz tracking-widest animate-neon-flicker uppercase">ALAZ NEON</h1>
                    {room && (gameState === 'playing' || gameState === 'review' || gameState === 'finished') && (
                        <div className="flex items-center gap-2 px-4 py-2 border border-alaz-orange/30 rounded-xl bg-alaz-orange/10">
                            <NeonIcon type="history" color="orange" className="w-5 h-5 animate-spin-slow" />
                            <span className="text-alaz-orange font-black text-lg tracking-widest">
                                TUR {room.current_round} / {room.total_rounds}
                            </span>
                        </div>
                    )}
                    <div className="flex items-center gap-4">
                        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black">Oda Kodu</span>
                        <span className="text-2xl font-mono font-black text-white bg-white/10 px-4 py-1.5 rounded-lg border border-white/20">
                            {room?.code || '...'}
                        </span>
                    </div>
                </header>
            )}

            <div className="flex-1 flex items-center justify-center relative w-full">
                <AnimatePresence mode="wait">
                    {/* INTRO (The Kinetic Spark) */}
                    {gameState === 'intro' && (
                        <motion.div
                            key="intro"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, scale: 1.2, filter: 'blur(40px)' }}
                            transition={{ duration: 1.5, ease: "circIn" }}
                            className="bg-black fixed inset-0 z-[100] flex items-center justify-center overflow-hidden noise-suppression"
                        >
                            <div className="relative w-full max-w-7xl flex flex-col items-center justify-center">
                                <KineticSpark delay={0.5} />

                                {/* Background Ambient Bloom */}
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: [0, 0.1, 0.05, 0.15] }}
                                    transition={{ delay: 2, duration: 4, repeat: Infinity, repeatType: "mirror" }}
                                    className="absolute inset-0 bg-alaz-orange/10 blur-[150px] -z-10 rounded-full"
                                />
                            </div>
                        </motion.div>
                    )}

                    {/* LOBBY */}
                    {gameState === 'lobby' && (
                        <motion.div key="lobby" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-4 gap-8">
                            <div className="md:col-span-3 glass-panel-alaz p-12 text-left relative overflow-hidden group">
                                <div className="relative z-10 flex items-start gap-8">
                                    <div className="flex-1">
                                        <h2 className="text-glow-alaz text-5xl font-black italic mb-6 animate-pulse">Oyun Başlıyor!</h2>
                                        <p className="text-gray-400 text-xl max-w-md leading-relaxed">
                                            Kelimelerin kadim ateşini uyandırın. Bu oyun <strong>{room?.total_rounds} tur</strong> sürecek.
                                        </p>
                                        <div className="mt-12 flex gap-12 items-end">
                                            <div>
                                                <span className="text-gray-500 uppercase tracking-widest text-xs font-black block mb-2">ODA GİRİŞ KODU</span>
                                                <div className="text-9xl font-mono font-black text-white bg-white/5 px-10 py-5 rounded-3xl border-2 border-alaz-orange text-glow-alaz">
                                                    {room?.code || '...'}
                                                </div>
                                            </div>
                                            {room?.code && (
                                                <div className="bg-white p-4 rounded-3xl shadow-[0_0_40px_rgba(255,77,0,0.5)] border-4 border-alaz-orange animate-beat flex flex-col items-center gap-2">
                                                    <QRCodeSVG
                                                        value={`${window.location.protocol}//${window.location.host}/join?code=${room.code}`}
                                                        size={140}
                                                        bgColor="#ffffff"
                                                        fgColor="#000000"
                                                        level="H"
                                                        marginSize={1}
                                                    />
                                                    <span className="text-black text-[10px] font-black uppercase tracking-widest">Kameranı Okut</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="absolute top-10 right-10 opacity-10"><NeonIcon type="rocket" color="orange" className="w-32 h-32 animate-beat" /></div>
                                </div>
                                <div className="absolute top-0 right-0 w-64 h-64 bg-alaz-orange/10 blur-[100px] -mr-32 -mt-32" />
                            </div>

                            <div className="md:col-span-1 glass-panel-pulse-blue p-8 flex flex-col justify-center text-center group">
                                <NeonIcon type="users" color="blue" className="mx-auto mb-4 animate-beat" />
                                <h3 className="text-3xl font-black text-white group-hover:text-glow-blue transition-all">{players.length}</h3>
                                <p className="text-gray-400 text-sm uppercase tracking-widest font-bold">Takımlar</p>
                                <div className="mt-8 pt-8 border-t border-white/10">
                                    <button onClick={startGame} disabled={players.length < 1} className={`w-full py-4 rounded-2xl font-black transition-all ${players.length < 1 ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-white text-black hover:bg-alaz-orange hover:text-white shadow-[0_0_20px_rgba(255,77,0,0.3)] hover:scale-105'}`}>
                                        OYUNU BAŞLAT
                                    </button>
                                </div>
                            </div>

                            <div className="md:col-span-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 pt-4">
                                <AnimatePresence>
                                    {players.map((p) => (
                                        <motion.div key={p.id} initial={{ opacity: 0, scale: 0.5, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="glass-panel-pulse-blue p-6 text-center group">
                                            <p className="text-2xl font-bold group-hover:text-glow-blue transition-all truncate">{p.name}</p>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    )}

                    {/* COUNTDOWN */}
                    {gameState === 'countdown' && (
                        <motion.div key="countdown" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1.2, opacity: 1 }} exit={{ scale: 2, opacity: 0, filter: 'blur(20px)' }} className="flex flex-col items-center justify-center">
                            <span className="text-[20rem] font-black text-glow-ultra-alaz animate-pulse">{countdownNumber}</span>
                        </motion.div>
                    )}

                    {/* PLAYING */}
                    {gameState === 'playing' && (
                        <motion.div key="playing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full h-full flex flex-col items-center justify-center gap-12">
                            <div className="flex items-center gap-16 relative">
                                <motion.div initial={{ x: -100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="relative">
                                    <div className="w-56 h-56 rounded-[2rem] glass-panel-alaz border-4 border-alaz-orange flex items-center justify-center shadow-[0_0_80px_rgba(255,77,0,0.3)] bg-seljuk-pattern animate-beat">
                                        <span className="text-[10rem] font-black text-white text-glow-ultra-alaz leading-none">{currentLetter}</span>
                                    </div>
                                </motion.div>
                                <div className="h-40 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
                                <motion.div initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="text-left">
                                    <div className="flex items-baseline gap-4">
                                        <span className={`text-[12rem] font-black leading-none tracking-tighter ${timeLeft <= 10 ? 'text-glow-ultra-alaz animate-pulse' : 'text-white'}`}>{timeLeft}</span>
                                        <span className="text-2xl font-black text-gray-500 uppercase tracking-widest">Saniye</span>
                                    </div>
                                </motion.div>
                            </div>
                            <div className="w-full max-w-7xl px-8">
                                <div className="grid grid-cols-5 gap-6">
                                    {(room?.categories || []).map((cat, idx) => (
                                        <motion.div key={cat} initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: idx * 0.1 }} className="glass-panel-alaz p-6 text-center border-white/5">
                                            <span className="text-[10px] text-gray-500 font-black uppercase tracking-[0.2em] mb-2 block">{idx + 1}. KATEGORİ</span>
                                            <p className="text-xl font-black text-white">{cat}</p>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* REVIEW (End of Round) */}
                    {gameState === 'review' && (
                        <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full h-full flex flex-col pt-10">
                            {isAnalyzing ? (
                                <div className="flex-1 flex flex-col items-center justify-center space-y-8 animate-pulse">
                                    <div className="w-32 h-32 rounded-full border-8 border-alaz-orange border-t-transparent animate-spin" />
                                    <div className="text-center">
                                        <h2 className="text-4xl font-black text-white uppercase tracking-widest mb-2">PUANLAR ANALİZ EDİLİYOR</h2>
                                        <p className="text-alaz-orange font-bold tracking-[0.3em] uppercase">Zihinlerin ateşi ölçülüyor...</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="w-full h-full flex flex-col">
                                    <div className="text-center mb-8">
                                        <h2 className="text-5xl font-black text-white uppercase tracking-[0.2em] text-glow-ultra-alaz animate-glitch mb-2">
                                            TUR {room?.current_round} ÖZETİ
                                        </h2>
                                        <p className="text-gray-400 text-lg uppercase font-black tracking-widest">Sistem Puanları Analiz Etti</p>
                                    </div>

                                    <div className="flex-1 flex gap-8 overflow-hidden w-full max-w-7xl mx-auto pb-10">
                                        {/* Leaderboard */}
                                        <div className="w-1/3 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
                                            <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-2 sticky top-0 bg-[#0a0f16] py-2 z-10 w-full">Genel Sıralama</h3>
                                            {[...players].sort((a, b) => b.total_score - a.total_score).map((p, i) => {
                                                const rRes = roundResults.find(r => r.playerId === p.id);
                                                return (
                                                    <motion.div key={p.id} initial={{ x: -50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.1 }} className={`p-5 rounded-2xl border ${i === 0 ? 'bg-alaz-orange/10 border-alaz-orange shadow-lg' : 'bg-white/5 border-white/10'}`}>
                                                        <div className="flex justify-between items-center mb-2">
                                                            <span className="text-2xl font-black text-white">#{i + 1} {p.name}</span>
                                                            <span className={`text-4xl font-black ${i === 0 ? 'text-alaz-orange' : 'text-gray-300'}`}>{p.total_score}</span>
                                                        </div>
                                                        {rRes && (
                                                            <div className="text-[11px] font-black tracking-widest text-green-400 text-right uppercase">
                                                                Bu Tur: +{rRes.roundScore} Puan
                                                            </div>
                                                        )}
                                                    </motion.div>
                                                );
                                            })}
                                        </div>

                                        {/* Answers Breakdown */}
                                        <div className="w-2/3 glass-panel-alaz p-6 border-white/5 flex flex-col relative overflow-hidden">
                                            <div className="absolute top-0 right-0 w-64 h-64 bg-alaz-orange/5 blur-[100px] pointer-events-none" />
                                            <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest mb-6 relative z-10">Kategori Analizi</h3>
                                            <div className="flex-1 overflow-y-auto space-y-8 pr-4 custom-scrollbar relative z-10">
                                                {(room?.categories || []).map((cat, catIdx) => (
                                                    <div key={cat} className="space-y-3">
                                                        <h4 className="text-alaz-orange font-black text-lg uppercase tracking-tight pb-2 border-b border-white/10 flex items-center gap-2">
                                                            <span className="w-6 h-6 rounded-full bg-alaz-orange/20 flex items-center justify-center text-[10px]">{catIdx + 1}</span>
                                                            {cat}
                                                        </h4>
                                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                                            {roundResults.map(res => {
                                                                const ans = res.answers[cat];
                                                                const isRejected = !ans?.isValid;
                                                                return (
                                                                    <motion.div 
                                                                        key={res.playerId} 
                                                                        whileHover={{ scale: 1.02 }}
                                                                        whileTap={{ scale: 0.98 }}
                                                                        onClick={() => toggleAnswerValidity(res.playerId, cat)}
                                                                        className={`p-4 rounded-xl border cursor-pointer transition-all duration-300 relative overflow-hidden group/ans
                                                                            ${!isRejected 
                                                                                ? (ans.isUnique ? 'border-green-500/50 bg-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]' : 'border-white/20 bg-white/10') 
                                                                                : 'border-red-500/40 bg-red-500/10 grayscale-[0.5]'
                                                                            }`}
                                                                    >
                                                                        {/* Reject Hover Overlay */}
                                                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/ans:opacity-100 flex items-center justify-center transition-opacity z-10">
                                                                            <span className="text-[10px] font-black tracking-widest text-white uppercase bg-red-600 px-3 py-1 rounded-full shadow-lg">
                                                                                {isRejected ? 'ONAYLA' : 'REDDET'}
                                                                            </span>
                                                                        </div>

                                                                        <div className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-1 truncate">{res.name}</div>
                                                                        <div className={`text-lg font-bold mb-2 truncate ${isRejected ? 'text-gray-500 line-through decoration-red-500/50' : 'text-white'}`}>
                                                                            {ans?.value || <span className="text-red-500/50 text-sm italic">BOŞ</span>}
                                                                        </div>
                                                                        <div className={`text-[10px] font-black uppercase flex items-center gap-1.5 ${!isRejected ? (ans.isUnique ? 'text-green-400' : 'text-white') : 'text-red-400'}`}>
                                                                            {!isRejected ? (
                                                                                <>
                                                                                    <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                                                                                    +{ans.points} Puan {ans.isUnique ? '(Benzersiz)' : ''}
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                                                                    {ans?.value && ans.value.toLowerCase().startsWith((room?.active_letter || currentLetter).toLowerCase()) 
                                                                                        ? 'HOST REDDETTİ' : 'GEÇERSİZ HARF'}
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </motion.div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}

                                                {/* Early bonus section */}
                                                {roundResults.some(r => r.earlyBonus) && (
                                                    <div className="mt-6 p-4 rounded-2xl border border-neon-blue bg-neon-blue/10 flex items-center gap-4">
                                                        <NeonIcon type="rocket" color="blue" className="w-8 h-8 animate-beat" />
                                                        <div>
                                                            <h4 className="text-neon-blue font-black tracking-widest uppercase">GÜMÜŞ FİŞEK YOLCUSU (HIZ BONUSU)</h4>
                                                            <p className="text-white text-sm font-bold">
                                                                {roundResults.find(r => r.earlyBonus)?.name} önce ateşledi! <span className="text-neon-blue">+15 PUAN</span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="mt-8 relative z-10 flex justify-end">
                                                <motion.button onClick={nextStep} whileHover={{ scale: 1.05 }} className="w-full py-5 bg-alaz-orange text-black font-black text-xl rounded-2xl shadow-[0_0_30px_rgba(255,77,0,0.3)] transition-all">
                                                    {room!.current_round >= room!.total_rounds ? 'SONUÇLARI GÖR →' : 'SONRAKİ TURA GEÇ →'}
                                                </motion.button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* FINISHED PODIUM */}
                    {gameState === 'finished' && (
                        <motion.div key="finished" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center min-h-full w-full py-20 overflow-y-auto">
                            <motion.h2 initial={{ y: -50, opacity: 0, scale: 0.8 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ delay: 0.2, type: 'spring' }} className="text-7xl font-black text-white mb-20 uppercase tracking-[0.2em] text-glow-ultra-alaz">
                                ŞAMPİYONLAR
                            </motion.h2>

                            <div className="flex items-end justify-center w-full max-w-4xl gap-4 h-96 pb-12 border-b-2 border-white/10 relative">
                                <div className="absolute inset-0 bg-gradient-to-t from-alaz-orange/5 to-transparent pointer-events-none" />

                                {(() => {
                                    const sorted = [...players].sort((a, b) => b.total_score - a.total_score);
                                    const second = sorted[1];
                                    const first = sorted[0];
                                    const third = sorted[2];

                                    return (
                                        <>
                                            {/* 2nd Place */}
                                            {second && (
                                                <motion.div initial={{ height: 0 }} animate={{ height: '60%' }} transition={{ delay: 1, duration: 1 }} className="w-64 bg-white/10 border-t-2 border-l-2 border-r-2 border-white/20 rounded-t-3xl flex flex-col items-center justify-start pt-8 relative group">
                                                    <div className="absolute -top-16 text-center w-full">
                                                        <div className="text-4xl font-black text-white truncate max-w-[240px] px-2 mx-auto">{second.name}</div>
                                                        <div className="text-2xl font-black text-gray-400">{second.total_score} PTS</div>
                                                    </div>
                                                    <div className="text-6xl font-black text-white/20">2</div>
                                                </motion.div>
                                            )}

                                            {/* 1st Place */}
                                            {first && (
                                                <motion.div initial={{ height: 0 }} animate={{ height: '100%' }} transition={{ delay: 1.5, duration: 1, type: 'spring' }} className="w-72 bg-gradient-to-b from-alaz-orange/40 to-alaz-orange/5 border-t-4 border-l-4 border-r-4 border-alaz-orange rounded-t-3xl flex flex-col items-center justify-start pt-8 relative z-10 shadow-[0_-20px_80px_rgba(255,77,0,0.3)]">
                                                    <div className="absolute -top-24 text-center w-full">
                                                        <NeonIcon type="crown" color="orange" className="w-12 h-12 mx-auto mb-2 animate-beat drop-shadow-[0_0_20px_rgba(255,77,0,1)]" />
                                                        <div className="text-5xl font-black text-glow-alaz text-alaz-orange truncate max-w-[280px] px-2 mx-auto">{first.name}</div>
                                                        <div className="text-3xl font-black text-white">{first.total_score} PTS</div>
                                                    </div>
                                                    <div className="text-8xl font-black text-alaz-orange/40 mt-4">1</div>
                                                </motion.div>
                                            )}

                                            {/* 3rd Place */}
                                            {third && (
                                                <motion.div initial={{ height: 0 }} animate={{ height: '40%' }} transition={{ delay: 0.5, duration: 1 }} className="w-64 bg-white/5 border-t border-l border-r border-white/10 rounded-t-3xl flex flex-col items-center justify-start pt-8 relative">
                                                    <div className="absolute -top-16 text-center w-full">
                                                        <div className="text-3xl font-black text-white truncate max-w-[240px] px-2 mx-auto">{third.name}</div>
                                                        <div className="text-xl font-black text-gray-500">{third.total_score} PTS</div>
                                                    </div>
                                                    <div className="text-5xl font-black text-white/10">3</div>
                                                </motion.div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>

                            {/* OYUNUN ENLERI (AWARDS) */}
                            <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.5, duration: 1 }} className="mt-12 w-full max-w-5xl">
                                <h3 className="text-center text-sm font-black text-gray-500 uppercase tracking-widest mb-6">OYUNUN EN'LERİ</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {(() => {
                                        const getWinner = (key: 'uniqueCount' | 'earlyCount' | 'blankCount') => {
                                            let max = 0; let pid = '';
                                            Object.entries(playerStats).forEach(([id, stats]) => {
                                                if (stats[key] > max) { max = stats[key]; pid = id; }
                                            });
                                            const p = players.find(x => x.id === pid);
                                            return max > 0 && p ? { name: p.name, count: max } : null;
                                        };

                                        const uniqueW = getWinner('uniqueCount');
                                        const earlyW = getWinner('earlyCount');
                                        const blankW = getWinner('blankCount');

                                        return (
                                            <>
                                                {/* Mitik Yaratıcı */}
                                                <div className="glass-panel-alaz p-6 flex flex-col items-center justify-center text-center border-alaz-orange/30 group hover:border-alaz-orange transition-all">
                                                    <div className="w-16 h-16 rounded-full bg-alaz-orange/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-[0_0_20px_rgba(255,77,0,0.3)]">
                                                        <NeonIcon type="lightbulb" color="orange" className="w-8 h-8" />
                                                    </div>
                                                    <h4 className="text-alaz-orange font-black text-lg uppercase tracking-tight mb-1">MİTİK YARATICI</h4>
                                                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-4">En Yenilikçi Karakter</p>

                                                    {uniqueW ? (
                                                        <>
                                                            <div className="text-2xl font-black text-white truncate w-full px-2 mx-auto">{uniqueW.name}</div>
                                                            <div className="text-alaz-orange font-bold text-sm mt-1">{uniqueW.count} Benzersiz Cevap</div>
                                                        </>
                                                    ) : (
                                                        <div className="text-gray-600 font-bold italic">Herkes kopyacıydı!</div>
                                                    )}
                                                </div>

                                                {/* Ateşin Oğlu */}
                                                <div className="glass-panel-pulse-blue p-6 flex flex-col items-center justify-center text-center border-neon-blue/30 group hover:border-neon-blue transition-all">
                                                    <div className="w-16 h-16 rounded-full bg-neon-blue/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-[0_0_20px_rgba(0,255,255,0.3)]">
                                                        <NeonIcon type="rocket" color="blue" className="w-8 h-8" />
                                                    </div>
                                                    <h4 className="text-neon-blue font-black text-lg uppercase tracking-tight mb-1">ATEŞİN OĞLU</h4>
                                                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-4">Fırtına Gemi Kaptanı</p>

                                                    {earlyW ? (
                                                        <>
                                                            <div className="text-2xl font-black text-white truncate w-full px-2 mx-auto">{earlyW.name}</div>
                                                            <div className="text-neon-blue font-bold text-sm mt-1">{earlyW.count} Hız Bonusu</div>
                                                        </>
                                                    ) : (
                                                        <div className="text-gray-600 font-bold italic">Kimse acele etmedi.</div>
                                                    )}
                                                </div>

                                                {/* Hayalet */}
                                                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-center justify-center text-center group hover:bg-white/10 transition-all">
                                                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform text-3xl">👻</div>
                                                    <h4 className="text-gray-300 font-black text-lg uppercase tracking-tight mb-1">LOBİ HAYALETİ</h4>
                                                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-4">Boş Kağıt Uzmanı</p>

                                                    {blankW ? (
                                                        <>
                                                            <div className="text-2xl font-black text-gray-300 truncate w-full px-2 mx-auto">{blankW.name}</div>
                                                            <div className="text-gray-500 font-bold text-sm mt-1">{blankW.count} Boş Cevap</div>
                                                        </>
                                                    ) : (
                                                        <div className="text-green-500/50 font-bold italic">Kağıtlar ful dolu!</div>
                                                    )}
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </motion.div>

                            <motion.button
                                onClick={resetGame}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 4 }}
                                className="mt-16 px-12 py-4 border-2 border-white/20 hover:border-white/50 text-white font-black rounded-2xl transition-all uppercase tracking-widest hover:bg-white/5 relative z-20 mb-20"
                            >
                                Yeni Oyun Başlat
                            </motion.button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
