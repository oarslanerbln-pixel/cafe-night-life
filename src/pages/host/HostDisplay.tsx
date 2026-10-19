import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ParticleBackground } from '../../components/ParticleBackground';
import { NeonIcon } from '../../components/NeonIcon';
import { KineticSpark } from '../../components/KineticSpark';
import { Leaderboard } from '../../components/Leaderboard';
import type { LeaderboardEntry } from '../../components/Leaderboard';
import { SCORING, overrideKey, rankStandings, scoreRound } from '../../lib/scoring';
import type { AnswerStatus, Overrides, Submission } from '../../lib/scoring';
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

type PlayerStats = { uniqueCount: number; earlyCount: number; blankCount: number };

const ANSWER_STYLE: Record<AnswerStatus, { card: string; text: string; label: (pts: number) => string }> = {
    unique: { card: 'border-green-500/50 bg-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]', text: 'text-green-400', label: pts => `BENZERSİZ · +${pts}` },
    shared: { card: 'border-white/20 bg-white/10', text: 'text-white', label: pts => `ORTAK · +${pts}` },
    blank: { card: 'border-white/5 bg-white/[0.03]', text: 'text-gray-600', label: () => 'BOŞ' },
    'wrong-letter': { card: 'border-red-500/40 bg-red-500/10', text: 'text-red-400', label: () => 'YANLIŞ HARF' },
    rejected: { card: 'border-red-500/40 bg-red-500/10', text: 'text-red-400', label: () => 'HOST REDDETTİ' },
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
    // Round being reviewed: raw submissions + host verdicts. Scores are derived from these (see roundResults).
    const [roundSubmissions, setRoundSubmissions] = useState<Submission[]>([]);
    const [roundLetter, setRoundLetter] = useState('?');
    const [overrides, setOverrides] = useState<Overrides>({});
    // Totals/unique counts as they stood when the round ended, so the review table shows "before + this round"
    const [roundBase, setRoundBase] = useState<Record<string, { total: number; unique: number }>>({});
    const [roundHistory, setRoundHistory] = useState<{ round: number; scores: Record<string, number> }[]>([]);
    const advancingRef = useRef(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Stats for Podium Badges
    const [playerStats, setPlayerStats] = useState<Record<string, PlayerStats>>({});

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

        const { data: fetchedAnswers } = await supabase
            .from('answers')
            .select('player_id, data, created_at')
            .eq('room_id', roomId)
            .eq('round_letter', letterToQuery)
            .order('created_at', { ascending: true });

        // Rows are keyed by letter only, so a letter drawn again (another round or "Yeni Oyun")
        // would pull in old answers. Players tag each row with its round; untagged rows are legacy.
        const submissions: Submission[] = (fetchedAnswers ?? [])
            .map(a => ({ playerId: a.player_id as string, data: (a.data ?? {}) as Record<string, string> }))
            .filter(a => a.data._round === undefined || a.data._round === String(room.current_round));

        if (submissions.length === 0) console.log("Cevap bulunamadı. Sorgu harfi:", letterToQuery);

        setRoundLetter(letterToQuery);
        setRoundSubmissions(submissions);
        setOverrides({});
        setRoundBase(Object.fromEntries(players.map(p => [p.id, { total: p.total_score, unique: playerStats[p.id]?.uniqueCount ?? 0 }])));
        setIsAnalyzing(false);
    };

    const roundResults = useMemo(() => scoreRound({
        categories: room?.categories ?? [],
        letter: roundLetter,
        submissions: roundSubmissions,
        playerIds: players.map(p => p.id),
        overrides,
    }), [room?.categories, roundLetter, roundSubmissions, players, overrides]);

    // Review table: everyone's total including this round (live as the host accepts/rejects answers)
    const reviewStandings = useMemo((): LeaderboardEntry[] => {
        const base = (id: string, fallback: number) => roundBase[id]?.total ?? fallback;
        const before = rankStandings(players.map(p => ({ id: p.id, name: p.name, total: base(p.id, p.total_score), tiebreak: roundBase[p.id]?.unique ?? 0 })));
        const rankBefore = new Map(before.map(e => [e.id, e.rank]));
        const byPlayer = new Map(roundResults.map(r => [r.playerId, r]));
        const hasHistory = (room?.current_round ?? 0) > 1;

        return rankStandings(players.map(p => {
            const r = byPlayer.get(p.id);
            return {
                id: p.id,
                name: p.name,
                total: base(p.id, p.total_score) + (r?.roundScore ?? 0),
                tiebreak: (roundBase[p.id]?.unique ?? 0) + (r?.uniqueCount ?? 0),
                roundScore: r?.roundScore ?? 0,
            };
        })).map(e => ({
            id: e.id,
            name: e.name,
            total: e.total,
            rank: e.rank,
            roundScore: e.roundScore,
            movement: hasHistory ? (rankBefore.get(e.id) ?? e.rank) - e.rank : undefined,
        }));
    }, [players, roundBase, roundResults, room?.current_round]);

    const finalStandings = useMemo((): LeaderboardEntry[] => rankStandings(
        players.map(p => ({ id: p.id, name: p.name, total: p.total_score, tiebreak: playerStats[p.id]?.uniqueCount ?? 0 })),
    ).map(e => ({
        id: e.id,
        name: e.name,
        total: e.total,
        rank: e.rank,
        rounds: roundHistory.length > 0 ? roundHistory.map(h => h.scores[e.id] ?? 0) : undefined,
    })), [players, playerStats, roundHistory]);

    const resetGame = async () => {
        if (!roomId) return;

        // Reset player scores and stats
        await supabase.from('players').update({ total_score: 0 }).eq('room_id', roomId);
        setPlayerStats({});
        setRoundHistory([]);
        setRoundSubmissions([]);
        setOverrides({});
        setRoundBase({});

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

    const playerName = (id: string) => players.find(p => p.id === id)?.name ?? '';

    const toggleAnswerValidity = (playerId: string, category: string) => {
        const answer = roundResults.find(r => r.playerId === playerId)?.answers[category];
        if (!answer || answer.status === 'blank') return;
        setOverrides(prev => ({ ...prev, [overrideKey(playerId, category)]: !answer.valid }));
    };

    const nextStep = async () => {
        if (!roomId || !room || advancingRef.current) return;
        advancingRef.current = true;

        try {
            // Host finished reviewing: commit totals (round start total + round score) to the players table
            await Promise.all(roundResults
                .filter(r => r.roundScore !== 0)
                .map(r => {
                    const start = roundBase[r.playerId]?.total ?? players.find(p => p.id === r.playerId)?.total_score ?? 0;
                    return supabase.from('players').update({ total_score: start + r.roundScore }).eq('id', r.playerId);
                }));

            setPlayerStats(prev => {
                const next = { ...prev };
                for (const r of roundResults) {
                    const s = next[r.playerId] ?? { uniqueCount: 0, earlyCount: 0, blankCount: 0 };
                    next[r.playerId] = {
                        uniqueCount: s.uniqueCount + r.uniqueCount,
                        earlyCount: s.earlyCount + (r.speedBonus ? 1 : 0),
                        blankCount: s.blankCount + r.blankCount,
                    };
                }
                return next;
            });
            setRoundHistory(prev => [
                ...prev.filter(h => h.round !== room.current_round),
                { round: room.current_round, scores: Object.fromEntries(roundResults.map(r => [r.playerId, r.roundScore])) },
            ]);

            // Refresh player list from DB for visual consistency
            const { data: updatedPlayers } = await supabase.from('players').select('id, name, total_score').eq('room_id', roomId);
            if (updatedPlayers) setPlayers(updatedPlayers);

            if (room.current_round >= room.total_rounds) {
                await supabase.from('rooms').update({ status: 'finished' }).eq('id', roomId);
                setGameState('finished');
            } else {
                await startGame();
            }
        } finally {
            advancingRef.current = false;
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
        <div className={`flex-none flex flex-col p-8 h-screen overflow-hidden ${gameState === 'playing' && timeLeft <= 10 ? 'animate-shake' : ''}`}>
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

            <div className="flex-1 min-h-0 flex items-center justify-center relative w-full">
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
                        <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full h-full min-h-0 flex flex-col pt-2">
                            {isAnalyzing ? (
                                <div className="flex-1 flex flex-col items-center justify-center space-y-8 animate-pulse">
                                    <div className="w-32 h-32 rounded-full border-8 border-alaz-orange border-t-transparent animate-spin" />
                                    <div className="text-center">
                                        <h2 className="text-4xl font-black text-white uppercase tracking-widest mb-2">PUANLAR ANALİZ EDİLİYOR</h2>
                                        <p className="text-alaz-orange font-bold tracking-[0.3em] uppercase">Zihinlerin ateşi ölçülüyor...</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="w-full h-full min-h-0 flex flex-col">
                                    <div className="text-center mb-4">
                                        <h2 className="text-5xl font-black text-white uppercase tracking-[0.2em] text-glow-ultra-alaz animate-glitch mb-2">
                                            TUR {room?.current_round} ÖZETİ
                                        </h2>
                                        <p className="text-gray-500 text-xs uppercase font-black tracking-[0.25em]">
                                            Benzersiz +{SCORING.unique} · Ortak +{SCORING.shared} · Hız bonusu +{SCORING.speedBonus} · Cevaba dokunarak onayla / reddet
                                        </p>
                                    </div>

                                    <div className="flex-1 min-h-0 flex gap-8 overflow-hidden w-full max-w-7xl mx-auto pb-2">
                                        {/* Standings: everyone's total including this round */}
                                        <div className="w-5/12 glass-panel-alaz p-6 flex flex-col overflow-hidden">
                                            <div className="mb-4 flex items-baseline justify-between">
                                                <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest">Puan Durumu</h3>
                                                <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Bu tur dahil toplam</span>
                                            </div>
                                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                                <Leaderboard entries={reviewStandings} />
                                            </div>
                                        </div>

                                        {/* Answers Breakdown */}
                                        <div className="w-7/12 glass-panel-alaz p-6 border-white/5 flex flex-col relative overflow-hidden">
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
                                                                const style = ANSWER_STYLE[ans.status];
                                                                const blank = ans.status === 'blank';
                                                                const toggle = () => toggleAnswerValidity(res.playerId, cat);
                                                                return (
                                                                    <motion.div
                                                                        key={res.playerId}
                                                                        role={blank ? undefined : 'button'}
                                                                        tabIndex={blank ? undefined : 0}
                                                                        whileHover={blank ? undefined : { scale: 1.02 }}
                                                                        whileTap={blank ? undefined : { scale: 0.98 }}
                                                                        onClick={toggle}
                                                                        onKeyDown={blank ? undefined : (e) => {
                                                                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
                                                                        }}
                                                                        className={`p-4 rounded-xl border transition-all duration-300 relative overflow-hidden group/ans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alaz-orange/60 ${blank ? 'cursor-default' : 'cursor-pointer'} ${style.card}`}
                                                                    >
                                                                        {!blank && (
                                                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/ans:opacity-100 group-focus-visible/ans:opacity-100 flex items-center justify-center transition-opacity z-10">
                                                                                <span className={`text-[10px] font-black tracking-widest text-white uppercase px-3 py-1 rounded-full shadow-lg ${ans.valid ? 'bg-red-600' : 'bg-green-600'}`}>
                                                                                    {ans.valid ? 'REDDET' : 'ONAYLA'}
                                                                                </span>
                                                                            </div>
                                                                        )}

                                                                        <div className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-1 truncate">{playerName(res.playerId)}</div>
                                                                        <div className={`text-lg font-bold mb-2 truncate ${blank ? 'text-gray-700' : ans.valid ? 'text-white' : 'text-gray-500 line-through decoration-red-500/50'}`}>
                                                                            {ans.value || '—'}
                                                                        </div>
                                                                        <div className={`text-[10px] font-black uppercase flex items-center gap-1.5 ${style.text}`}>
                                                                            <div className="w-1.5 h-1.5 rounded-full bg-current" />
                                                                            {style.label(ans.points)}{ans.overridden && ans.valid ? ' · HOST ONAYI' : ''}
                                                                        </div>
                                                                    </motion.div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}

                                                {/* Early bonus section */}
                                                {roundResults.some(r => r.speedBonus) && (
                                                    <div className="mt-6 p-4 rounded-2xl border border-neon-blue bg-neon-blue/10 flex items-center gap-4">
                                                        <NeonIcon type="rocket" color="blue" className="w-8 h-8 animate-beat" />
                                                        <div>
                                                            <h4 className="text-neon-blue font-black tracking-widest uppercase">GÜMÜŞ FİŞEK YOLCUSU (HIZ BONUSU)</h4>
                                                            <p className="text-white text-sm font-bold">
                                                                {playerName(roundResults.find(r => r.speedBonus)!.playerId)} önce ateşledi! <span className="text-neon-blue">+{SCORING.speedBonus} PUAN</span>
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
                        <motion.div key="finished" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full h-full min-h-0 overflow-y-auto custom-scrollbar flex flex-col items-center gap-4 py-2">
                            <motion.h2 initial={{ y: -50, opacity: 0, scale: 0.8 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ delay: 0.2, type: 'spring' }} className="text-6xl font-black text-white uppercase tracking-[0.2em] text-glow-ultra-alaz">
                                ŞAMPİYONLAR
                            </motion.h2>

                            <div className="w-full max-w-7xl px-8 grid grid-cols-5 gap-10 items-end">
                                {/* Podium: labels sit above each bar in normal flow so they can never overlap it or the title */}
                                <div className="col-span-3 relative flex items-end justify-center gap-4 h-[22rem] border-b-2 border-white/10">
                                    <div className="absolute inset-0 bg-gradient-to-t from-alaz-orange/5 to-transparent pointer-events-none" />
                                    {[
                                        { entry: finalStandings[1], bar: 150, delay: 1, width: 'w-56', name: 'text-3xl text-white', pts: 'text-xl text-gray-400', numeral: 'text-6xl text-white/25', box: 'bg-white/10 border-white/20' },
                                        { entry: finalStandings[0], bar: 200, delay: 1.5, width: 'w-64', name: 'text-4xl text-alaz-orange text-glow-alaz', pts: 'text-2xl text-white', numeral: 'text-8xl text-alaz-orange/40', box: 'bg-gradient-to-b from-alaz-orange/40 to-alaz-orange/5 border-alaz-orange border-t-4 shadow-[0_-20px_80px_rgba(255,77,0,0.3)]' },
                                        { entry: finalStandings[2], bar: 110, delay: 0.5, width: 'w-56', name: 'text-2xl text-white', pts: 'text-lg text-gray-500', numeral: 'text-5xl text-white/15', box: 'bg-white/5 border-white/10' },
                                    ].map(({ entry, bar, delay, width, name, pts, numeral, box }, i) => entry && (
                                        <div key={entry.id} className={`relative z-10 flex flex-col items-center justify-end ${width}`}>
                                            <div className="mb-3 w-full px-2 text-center">
                                                {i === 1 && <NeonIcon type="crown" color="orange" className="w-12 h-12 mx-auto mb-1 animate-beat drop-shadow-[0_0_20px_rgba(255,77,0,1)]" />}
                                                <div className={`truncate font-black ${name}`}>{entry.name}</div>
                                                <div className={`font-black tabular-nums ${pts}`}>{entry.total} PTS</div>
                                            </div>
                                            <motion.div
                                                initial={{ height: 0 }}
                                                animate={{ height: bar }}
                                                transition={{ delay, duration: 1 }}
                                                className={`w-full rounded-t-3xl border-t-2 border-x-2 flex items-start justify-center pt-5 ${box}`}
                                            >
                                                <span className={`font-black ${numeral}`}>{entry.rank}</span>
                                            </motion.div>
                                        </div>
                                    ))}
                                </div>

                                {/* Full standings with per-round points */}
                                <div className="col-span-2 glass-panel-alaz p-5">
                                    <h3 className="mb-3 text-sm font-black text-gray-500 uppercase tracking-widest">Final Tablosu</h3>
                                    <Leaderboard entries={finalStandings} variant="final" />
                                </div>
                            </div>

                            {/* OYUNUN ENLERI (AWARDS) */}
                            <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.5, duration: 1 }} className="w-full max-w-5xl">
                                <h3 className="text-center text-sm font-black text-gray-500 uppercase tracking-widest mb-3">OYUNUN EN'LERİ</h3>
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
                                                <div className="glass-panel-alaz p-4 flex flex-col items-center justify-center text-center border-alaz-orange/30 group hover:border-alaz-orange transition-all">
                                                    <div className="w-16 h-16 rounded-full bg-alaz-orange/20 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform shadow-[0_0_20px_rgba(255,77,0,0.3)]">
                                                        <NeonIcon type="lightbulb" color="orange" className="w-8 h-8" />
                                                    </div>
                                                    <h4 className="text-alaz-orange font-black text-lg uppercase tracking-tight mb-1">MİTİK YARATICI</h4>
                                                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">En Yenilikçi Karakter</p>

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
                                                <div className="glass-panel-pulse-blue p-4 flex flex-col items-center justify-center text-center border-neon-blue/30 group hover:border-neon-blue transition-all">
                                                    <div className="w-16 h-16 rounded-full bg-neon-blue/20 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform shadow-[0_0_20px_rgba(0,255,255,0.3)]">
                                                        <NeonIcon type="rocket" color="blue" className="w-8 h-8" />
                                                    </div>
                                                    <h4 className="text-neon-blue font-black text-lg uppercase tracking-tight mb-1">ATEŞİN OĞLU</h4>
                                                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Fırtına Gemi Kaptanı</p>

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
                                                <div className="bg-white/5 border border-white/10 rounded-3xl p-4 flex flex-col items-center justify-center text-center group hover:bg-white/10 transition-all">
                                                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform text-3xl">👻</div>
                                                    <h4 className="text-gray-300 font-black text-lg uppercase tracking-tight mb-1">LOBİ HAYALETİ</h4>
                                                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-2">Boş Kağıt Uzmanı</p>

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
                                className="px-12 py-4 border-2 border-white/20 hover:border-white/50 text-white font-black rounded-2xl transition-all uppercase tracking-widest hover:bg-white/5 relative z-20 mb-6"
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
