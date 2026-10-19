import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { NeonIcon } from '../../components/NeonIcon';
import { KineticSpark } from '../../components/KineticSpark';
import { CATEGORY_PRESETS } from '../../lib/categoryPresets';
import { SCORING } from '../../lib/scoring';

// Helper to generate a 4-character random code
const generateRoomCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
};

export function HostSetup() {
    const navigate = useNavigate();
    const [categories, setCategories] = useState('Stadt, Land, Fluss, Name, Tier');
    const [timerValue, setTimerValue] = useState('60');
    const [totalRounds, setTotalRounds] = useState('3');
    const [isCreating, setIsCreating] = useState(false);
    const [activePreset, setActivePreset] = useState<string | null>(null);
    const [showIntro, setShowIntro] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setShowIntro(false), 4000);
        return () => clearTimeout(timer);
    }, []);

    const applyPreset = (name: string) => {
        setCategories(CATEGORY_PRESETS[name].join(', '));
        setActivePreset(name);
    };

    const startLobby = async () => {
        setIsCreating(true);
        localStorage.setItem('cafe_game_timer', timerValue);
        localStorage.setItem('cafe_game_categories', categories);

        try {
            const parsedCategories = categories.split(',').map(c => c.trim()).filter(Boolean);
            const roomCode = generateRoomCode();

            const { data, error } = await supabase
                .from('rooms')
                .insert([
                    {
                        code: roomCode,
                        status: 'lobby',
                        categories: parsedCategories,
                        timer_setting: parseInt(timerValue, 10),
                        total_rounds: parseInt(totalRounds, 10),
                        current_round: 0,
                        time_left: 0,
                    }
                ])
                .select()
                .single();

            if (error) {
                console.error('Error creating room:', error);
                alert('Beim Erstellen des Raums ist ein Fehler aufgetreten: ' + error.message);
                setIsCreating(false);
                return;
            }

            if (data && data.id) {
                navigate(`/host/display?roomId=${data.id}`);
            }
        } catch (error) {
            console.error('Unexpected error:', error);
            setIsCreating(false);
        }
    };

    return (
        <div className="flex-1 p-10 max-w-5xl mx-auto w-full bg-seljuk-pattern min-h-screen relative overflow-hidden">
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
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1 }}
                        className="w-full h-full"
                    >
                        <header className="mb-12 pointer-events-none opacity-80 scale-75 origin-left">
                            <KineticSpark
                                fontSize="text-[9rem]"
                                className="max-w-md"
                                delay={0.1}
                            />
                        </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 auto-rows-[minmax(220px,auto)]">

                {/* Main Settings Panel */}
                <div className="md:col-span-2 md:row-span-2 glass-panel-alaz p-10 flex flex-col relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-alaz-orange/5 blur-[100px] -mr-32 -mt-32" />

                    <div className="flex justify-between items-start mb-10 relative z-10">
                        <div>
                            <h2 className="text-3xl font-black text-glow-alaz italic tracking-tighter uppercase">SPIELEINSTELLUNGEN</h2>
                            <p className="text-gray-500 text-sm">Lege Zeit, Rundenzahl und Kategorien fest.</p>
                        </div>
                        <div className="bg-alaz-orange/10 text-alaz-orange px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest border border-alaz-orange/30 uppercase">
                            Premium Mode
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 flex-1 relative z-10">
                        <div className="space-y-6">
                            {/* Timer */}
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.2em] font-black text-gray-500 mb-3">Zeit / Tempo</label>
                                <select
                                    value={timerValue}
                                    onChange={(e) => setTimerValue(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white focus:border-alaz-orange focus:outline-none transition-all font-bold text-base"
                                >
                                    <option value="30">30 Sekunden (Feuerprobe)</option>
                                    <option value="45">45 Sekunden (Hohes Tempo)</option>
                                    <option value="60">60 Sekunden (Standard)</option>
                                    <option value="90">90 Sekunden (Profi-Modus)</option>
                                </select>
                            </div>

                            {/* Total Rounds */}
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.2em] font-black text-gray-500 mb-3">Rundenzahl</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {['3', '5', '7', '10'].map(r => (
                                        <button
                                            key={r}
                                            onClick={() => setTotalRounds(r)}
                                            className={`py-3 rounded-xl font-black text-sm transition-all border ${totalRounds === r
                                                ? 'bg-alaz-orange text-black border-alaz-orange shadow-[0_0_20px_rgba(255,77,0,0.3)]'
                                                : 'bg-white/5 border-white/10 text-gray-400 hover:border-alaz-orange/40 hover:text-white'
                                                }`}
                                        >
                                            {r}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[10px] text-gray-600 mt-2 italic">{totalRounds} Runden × {timerValue} s = max. {parseInt(totalRounds) * parseInt(timerValue)} s Spielzeit</p>
                            </div>

                            {/* Language badge */}
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.2em] font-black text-gray-500 mb-3">Sprache</label>
                                <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white/40 italic flex items-center justify-between">
                                    <span>Deutsch</span>
                                    <div className="w-2 h-2 rounded-full bg-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                                </div>
                            </div>
                        </div>

                        {/* Categories Column */}
                        <div className="flex flex-col gap-4">
                            {/* Preset Buttons */}
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.2em] font-black text-gray-500 mb-3">Schnellauswahl</label>
                                <div className="flex flex-wrap gap-2">
                                    {Object.keys(CATEGORY_PRESETS).map(name => (
                                        <button
                                            key={name}
                                            onClick={() => applyPreset(name)}
                                            className={`px-3 py-1.5 rounded-full text-[10px] font-black tracking-wide transition-all border ${activePreset === name
                                                ? 'bg-alaz-orange/20 border-alaz-orange text-alaz-orange'
                                                : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30 hover:text-white'
                                                }`}
                                        >
                                            {name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Categories textarea */}
                            <div className="flex flex-col flex-1">
                                <label className="block text-[10px] uppercase tracking-[0.2em] font-black text-gray-500 mb-3">Kategorien (durch Komma getrennt)</label>
                                <textarea
                                    rows={5}
                                    value={categories}
                                    onChange={(e) => { setCategories(e.target.value); setActivePreset(null); }}
                                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-white focus:border-alaz-orange focus:outline-none flex-1 resize-none font-medium leading-relaxed"
                                    placeholder="Stadt, Land, Fluss..."
                                />
                                <p className="text-[10px] text-gray-500 mt-2 italic opacity-60">
                                    * 4–6 Kategorien sorgen für das beste Spielerlebnis.
                                </p>
                            </div>
                        </div>
                    </div>

                    <motion.button
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={startLobby}
                        disabled={isCreating}
                        className={`w-full py-6 mt-10 font-black text-2xl rounded-2xl transition-all duration-500 ${isCreating
                            ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                            : 'bg-white text-black hover:bg-alaz-orange hover:text-white shadow-[0_0_50px_rgba(255,77,0,0.2)] uppercase tracking-tight'
                            }`}
                    >
                        {isCreating ? 'WIRD GESTARTET...' : `LOBBY ÖFFNEN (${totalRounds} RUNDEN) →`}
                    </motion.button>
                </div>

                {/* Status Bento */}
                <div className="glass-panel-alaz p-8 flex flex-col justify-center group relative overflow-hidden">
                    <div className="absolute -bottom-4 -right-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <NeonIcon type="crown" color="orange" className="w-24 h-24" />
                    </div>
                    <div className="flex items-center gap-3 mb-6 relative z-10">
                        <NeonIcon type="crown" color="orange" className="w-6 h-6 animate-beat" />
                        <span className="text-alaz-orange text-[10px] font-black tracking-widest uppercase">Systemstatus</span>
                    </div>
                    <h3 className="text-3xl font-black mb-3 text-white">BEREIT</h3>
                    <p className="text-gray-400 text-xs leading-relaxed font-medium">
                        Das uralte Feuer ist noch nicht entfacht. Erstelle über das Hauptpanel eine Lobby.
                    </p>
                </div>

                {/* Scoring Info Bento */}
                <div className="glass-panel-alaz p-8 bg-gradient-to-br from-white/5 to-transparent group relative overflow-hidden">
                    <div className="w-14 h-14 rounded-2xl bg-alaz-orange/10 flex items-center justify-center mb-5 border border-alaz-orange/20 relative z-10">
                        <NeonIcon type="lightbulb" color="orange" />
                    </div>
                    <h3 className="text-lg font-black mb-3 text-white uppercase tracking-tight relative z-10">Punktevergabe</h3>
                    <div className="space-y-2 relative z-10">
                        <div className="flex justify-between text-[11px]">
                            <span className="text-gray-500">Einzigartige Antwort</span>
                            <span className="text-alaz-orange font-black">+{SCORING.unique} Punkte</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                            <span className="text-gray-500">Doppelte Antwort</span>
                            <span className="text-white font-black">+{SCORING.shared} Punkte</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                            <span className="text-gray-500">Tempobonus (früh abgeben)</span>
                            <span className="text-neon-blue font-black">+{SCORING.speedBonus} Punkte</span>
                        </div>
                    </div>
                    <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-alaz-orange/5 blur-3xl rounded-full" />
                </div>

                {/* History Bento */}
                <div className="glass-panel-alaz p-6 md:col-span-1 border-white/5 opacity-40 flex items-center justify-between group overflow-hidden relative">
                    <div className="flex items-center gap-5">
                        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                            <NeonIcon type="history" color="blue" className="w-5 h-5 opacity-50" />
                        </div>
                        <div>
                            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Letzte Spiele</h3>
                            <p className="text-[10px] text-gray-600">Noch keine Spiele</p>
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    )}
</AnimatePresence>
</div>
);
}
