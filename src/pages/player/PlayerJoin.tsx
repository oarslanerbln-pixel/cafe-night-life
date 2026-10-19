import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { KineticSpark } from '../../components/KineticSpark';

export function PlayerJoin() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const urlCode = searchParams.get('code');
    const [roomCode, setRoomCode] = useState(urlCode || '');
    const [nickname, setNickname] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [showIntro, setShowIntro] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setShowIntro(false), 4000);
        return () => clearTimeout(timer);
    }, []);

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg('');
        setIsLoading(true);

        try {
            const cleanCode = roomCode.trim().toUpperCase();

            // 1. Check if room exists and is in lobby state
            const { data: room, error: roomError } = await supabase
                .from('rooms')
                .select('id, status')
                .eq('code', cleanCode)
                .single();

            if (roomError || !room) {
                setErrorMsg('Raum nicht gefunden. Bitte prüfe den Code auf dem TV-Bildschirm.');
                setIsLoading(false);
                return;
            }

            if (room.status !== 'lobby') {
                setErrorMsg('Diesem Raum kann gerade niemand beitreten (das Spiel läuft bereits).');
                setIsLoading(false);
                return;
            }

            // 2. Insert Player into DB
            const { data: player, error: playerError } = await supabase
                .from('players')
                .insert([
                    {
                        room_id: room.id,
                        name: nickname.trim(),
                    }
                ])
                .select()
                .single();

            if (playerError) {
                setErrorMsg('Spieler konnte nicht angelegt werden: ' + playerError.message);
                setIsLoading(false);
                return;
            }

            // 3. Save player session locally and navigate to Waiting/Play screen
            if (player && player.id) {
                localStorage.setItem('cafe_game_playerId', player.id);
                localStorage.setItem('cafe_game_roomId', room.id);
                localStorage.setItem('cafe_game_playerName', player.name);
                navigate('/play');
            }

        } catch (err) {
            console.error(err);
            setErrorMsg('Ein unerwarteter Fehler ist aufgetreten.');
            setIsLoading(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center min-h-[100dvh] bg-seljuk-pattern relative overflow-hidden">
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
                            <KineticSpark delay={0.5} showTagline tagline="Uraltes Feuer • Moderner Geist" />
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
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                        className="w-full max-w-md"
                    >
                        {/* Brand Experience - HENGAME (Mini version) */}
                        <header className="mb-10 pointer-events-none opacity-80 scale-75">
                            <KineticSpark
                                fontSize="text-[8rem] md:text-[7rem]"
                                showTagline
                                delay={0.2}
                            />
                        </header>

                <form onSubmit={handleJoin} className="glass-panel-alaz p-8 md:p-10 space-y-8 relative overflow-hidden group">
                    {/* Background glow for the panel */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-alaz-orange/10 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-alaz-orange/20 transition-colors duration-700" />

                    {errorMsg && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            className="bg-red-500/10 text-red-400 border border-red-500/30 p-4 rounded-2xl text-sm font-bold"
                        >
                            {errorMsg}
                        </motion.div>
                    )}

                    <div className="space-y-3 text-left">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest ml-1">Raumcode</label>
                        <div className="relative">
                            <input
                                type="text"
                                required
                                maxLength={4}
                                value={roomCode}
                                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                placeholder="Z. B. 4X9B"
                                className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-5 text-center text-4xl tracking-[0.2em] uppercase font-black focus:outline-none focus:border-alaz-orange focus:ring-1 focus:ring-alaz-orange transition-all placeholder:opacity-20 text-white"
                            />
                            <div className="absolute inset-0 rounded-2xl pointer-events-none border border-alaz-orange/10 group-focus-within:border-alaz-orange/30 transition-colors" />
                        </div>
                    </div>

                    <div className="space-y-3 text-left">
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest ml-1">Spitzname / Teamname</label>
                        <input
                            type="text"
                            required
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            placeholder="Legendäres Team"
                            maxLength={20}
                            className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-5 text-center text-2xl font-bold focus:outline-none focus:border-neon-blue focus:ring-1 focus:ring-neon-blue transition-all placeholder:opacity-20 text-white"
                        />
                    </div>

                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 10 }}
                        type="submit"
                        disabled={isLoading}
                        className={`w-full py-5 font-black text-xl rounded-2xl transition-all ${isLoading
                            ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                            : 'bg-white text-black hover:bg-alaz-orange hover:text-white shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:shadow-[0_0_40px_rgba(255,77,0,0.4)]'
                            }`}
                    >
                        {isLoading ? 'VERBINDE...' : 'INS GETÜMMEL →'}
                    </motion.button>
                </form>

                <div className="mt-12 opacity-30">
                    <p className="text-[10px] text-gray-500 uppercase tracking-[0.3em] font-black">Powered by HENGAME</p>
                </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
